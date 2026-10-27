require("dotenv").config();
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const PORT = Number(process.env.PORT) || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
const PASSWORD = process.env.ADMIN_PASSWORD;
const BUCKET = "ecevault-files";
const COOKIE = "ecevault_session";
const SESSION_MS = 8 * 60 * 60 * 1000;
const MAX_FILE_SIZE = 50 * 1024 * 1024;

// Validate the Supabase URL before creating the client.
try {
    const parsedUrl = new globalThis.URL(SUPABASE_URL);

    if (parsedUrl.protocol !== "https:") {
        throw new Error("Supabase URL must use HTTPS.");
    }

    console.log("Supabase URL is valid:", parsedUrl.hostname);
} catch (err) {
    console.error("Invalid SUPABASE_URL configuration:", err.message);
    process.exit(1);
}

// Create the Supabase client.
const db = createClient(SUPABASE_URL, KEY, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
    }
});

const sessions = new Map();

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
    ".webp": "image/webp"
};

function json(res, data, status = 200, headers = {}) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store",
        ...headers
    });
    res.end(body);
}

function readBody(req, limit = MAX_FILE_SIZE) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let failed = false;

        req.on("data", chunk => {
            size += chunk.length;

            if (size > limit) {
                failed = true;
                reject(Object.assign(new Error("Request too large"), {
                    statusCode: 413
                }));
                req.destroy();
            } else {
                chunks.push(chunk);
            }
        });

        req.on("end", () => {
            if (!failed) resolve(Buffer.concat(chunks));
        });

        req.on("error", error => {
            if (!failed) reject(error);
        });
    });
}

function getCookies(req) {
    const result = {};

    for (const item of(req.headers.cookie || "").split(";")) {
        const index = item.indexOf("=");

        if (index < 0) continue;

        try {
            result[item.slice(0, index).trim()] =
                decodeURIComponent(item.slice(index + 1).trim());
        } catch {}
    }

    return result;
}

function isAdmin(req) {
    const token = getCookies(req)[COOKIE];
    const expiry = token && sessions.get(token);

    if (!expiry) return false;

    if (expiry <= Date.now()) {
        sessions.delete(token);
        return false;
    }

    return true;
}

function requireAdmin(req, res) {
    if (isAdmin(req)) return true;

    json(res, { error: "Admin login required" }, 401);
    return false;
}

function fileForFrontend(file) {
    return {
        id: file.id,
        name: file.name,
        semId: file.sem_id,
        subject: file.subject,
        category: file.category,
        size: Number(file.size || 0),
        mimeType: file.mime_type || "application/octet-stream",
        date: file.created_at,
        desc: file.description || ""
    };
}

async function removeStoredFiles(paths) {
    if (!paths.length) return;

    const { error } = await db.storage
        .from(BUCKET)
        .remove(paths);

    if (error) throw error;
}

async function handle(req, res) {
    let url;

    try {
        url = new URL(req.url, "http://localhost");
    } catch {
        return json(res, { error: "Invalid URL" }, 400);
    }

    const route = url.pathname;
    const method = req.method;

    if (method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
    }

    try {
        // Return subjects and file metadata.
        if (route === "/api/data" && method === "GET") {
            const [subjectsResult, filesResult] = await Promise.all([
                db.from("subjects")
                .select("sem_id,name")
                .order("sem_id")
                .order("name"),

                db.from("files")
                .select("*")
                .order("created_at", { ascending: false })
            ]);

            if (subjectsResult.error) throw subjectsResult.error;
            if (filesResult.error) throw filesResult.error;

            const subjects = {};

            for (const row of subjectsResult.data || []) {
                if (!subjects[row.sem_id]) subjects[row.sem_id] = [];
                subjects[row.sem_id].push(row.name);
            }

            return json(res, {
                subjects,
                files: (filesResult.data || []).map(fileForFrontend)
            });
        }

        // Admin login.
        if (route === "/api/admin/login" && method === "POST") {
            const body = JSON.parse(
                (await readBody(req, 16384)).toString("utf8") || "{}"
            );

            const supplied = Buffer.from(String(body.password || ""));
            const expected = Buffer.from(PASSWORD);

            const valid =
                supplied.length === expected.length &&
                crypto.timingSafeEqual(supplied, expected);

            if (!valid) {
                return json(res, { error: "Incorrect password" }, 401);
            }

            const token = crypto.randomBytes(32).toString("hex");

            sessions.set(token, Date.now() + SESSION_MS);

            return json(res, { success: true }, 200, {
                "Set-Cookie": `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`
            });
        }

        // Admin logout.
        if (route === "/api/admin/logout" && method === "POST") {
            const token = getCookies(req)[COOKIE];

            if (token) sessions.delete(token);

            return json(res, { success: true }, 200, {
                "Set-Cookie": `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
            });
        }

        if (route === "/api/admin/session" && method === "GET") {
            return json(res, { authenticated: isAdmin(req) });
        }

        // Upload a file to private Supabase Storage.
        if (route === "/api/upload" && method === "POST") {
            if (!requireAdmin(req, res)) return;

            const name = decodeURIComponent(req.headers["x-file-name"] || "file");
            const subject = decodeURIComponent(req.headers["x-subject"] || "");
            const semId = String(req.headers["x-semid"] || "");
            const category = decodeURIComponent(req.headers["x-category"] || "Other");
            const description = decodeURIComponent(req.headers["x-desc"] || "");
            const mimeType = String(
                req.headers["x-mime"] || "application/octet-stream"
            );
            const declaredSize =
                Number.parseInt(req.headers["x-size"] || "0", 10) || 0;

            if (!name || !subject || !semId) {
                return json(res, {
                    error: "Missing filename, subject, or semester"
                }, 400);
            }

            const buffer = await readBody(req);

            if (!buffer.length) {
                return json(res, { error: "Empty file" }, 400);
            }

            const id =
                Date.now().toString(36) + "-" +
                crypto.randomBytes(12).toString("hex");

            const { error: uploadError } = await db.storage
                .from(BUCKET)
                .upload(id, buffer, {
                    contentType: mimeType,
                    upsert: false
                });

            if (uploadError) throw uploadError;

            const { error: insertError } = await db.from("files").insert({
                id,
                name,
                sem_id: semId,
                subject,
                category,
                description,
                mime_type: mimeType,
                size: declaredSize || buffer.length,
                storage_path: id
            });

            if (insertError) {
                await db.storage.from(BUCKET).remove([id]);
                throw insertError;
            }

            return json(res, { success: true, id });
        }

        // Download a file from private storage.
        const downloadMatch = route.match(/^\/api\/download\/([^/]+)$/);

        if (downloadMatch && method === "GET") {
            const id = decodeURIComponent(downloadMatch[1]);

            const { data: file, error } = await db.from("files")
                .select("*")
                .eq("id", id)
                .maybeSingle();

            if (error) throw error;

            if (!file) {
                return json(res, { error: "File not found" }, 404);
            }

            const { data: blob, error: downloadError } = await db.storage
                .from(BUCKET)
                .download(file.storage_path);

            if (downloadError) throw downloadError;

            const buffer = Buffer.from(await blob.arrayBuffer());
            const safeName = String(file.name || "download")
                .replace(/[\r\n"]/g, "_");

            res.writeHead(200, {
                "Content-Type": file.mime_type || "application/octet-stream",
                "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
                "Content-Length": buffer.length,
                "Cache-Control": "private, no-store"
            });

            return res.end(buffer);
        }

        // Add a subject.
        if (route === "/api/subject" && method === "POST") {
            if (!requireAdmin(req, res)) return;

            const body = JSON.parse(
                (await readBody(req, 65536)).toString("utf8") || "{}"
            );

            const semId = String(body.semId || "").trim();
            const name = String(body.name || "").trim();

            if (!semId || !name) {
                return json(res, { error: "Missing semId or name" }, 400);
            }

            const { error } = await db.from("subjects").upsert({ sem_id: semId, name }, {
                onConflict: "sem_id,name",
                ignoreDuplicates: true
            });

            if (error) throw error;

            return json(res, { success: true });
        }

        // Delete a file and its metadata.
        const fileDeleteMatch = route.match(/^\/api\/file\/([^/]+)$/);

        if (fileDeleteMatch && method === "DELETE") {
            if (!requireAdmin(req, res)) return;

            const id = decodeURIComponent(fileDeleteMatch[1]);

            const { data: file, error } = await db.from("files")
                .select("id,storage_path")
                .eq("id", id)
                .maybeSingle();

            if (error) throw error;

            if (!file) {
                return json(res, { error: "File not found" }, 404);
            }

            await removeStoredFiles([file.storage_path]);

            const { error: deleteError } = await db.from("files")
                .delete()
                .eq("id", id);

            if (deleteError) throw deleteError;

            return json(res, { success: true });
        }

        // Delete a subject and all files belonging to it.
        const subjectDeleteMatch =
            route.match(/^\/api\/subject\/([^/]+)\/(.+)$/);

        if (subjectDeleteMatch && method === "DELETE") {
            if (!requireAdmin(req, res)) return;

            const semId = decodeURIComponent(subjectDeleteMatch[1]);
            const subject = decodeURIComponent(subjectDeleteMatch[2]);

            const { data: files, error: selectError } = await db.from("files")
                .select("storage_path")
                .eq("sem_id", semId)
                .eq("subject", subject);

            if (selectError) throw selectError;

            await removeStoredFiles((files || []).map(file => file.storage_path));

            const { error: filesError } = await db.from("files")
                .delete()
                .eq("sem_id", semId)
                .eq("subject", subject);

            if (filesError) throw filesError;

            const { error: subjectError } = await db.from("subjects")
                .delete()
                .eq("sem_id", semId)
                .eq("name", subject);

            if (subjectError) throw subjectError;

            return json(res, { success: true });
        }

        // Serve frontend files from the project directory only.
        let decodedPath;

        try {
            decodedPath = decodeURIComponent(route);
        } catch {
            return json(res, { error: "Invalid path" }, 400);
        }

        const requestPath = decodedPath === "/" ? "/index.html" : decodedPath;
        const filePath = path.resolve(__dirname, "." + requestPath);

        if (!filePath.startsWith(__dirname + path.sep)) {
            return json(res, { error: "Forbidden" }, 403);
        }

        fs.readFile(filePath, (error, data) => {
            if (error) {
                return json(res, { error: "Not found" }, 404);
            }

            res.writeHead(200, {
                "Content-Type": MIME[path.extname(filePath).toLowerCase()] ||
                    "application/octet-stream",
                "X-Content-Type-Options": "nosniff"
            });

            res.end(data);
        });

    } catch (error) {
        console.error("ECEVault server error:", error.message || error);

        const status = error.statusCode || 500;

        json(res, {
            error: status === 413 ?
                "File too large. Maximum upload size is 50 MB." : "Server error. Check Render logs."
        }, status);
    }
}

http.createServer(handle).listen(PORT, () => {
    console.log(`ECEVault listening on port ${PORT}`);
    console.log("Supabase database and private storage configured.");
});