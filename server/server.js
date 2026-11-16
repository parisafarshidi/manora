
import express from "express";
import cors from "cors";
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 3001;

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "manora_db",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD,
});

pool.on("error", (error) => {
  console.error("PostgreSQL pool error:", error.message);
});

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
  })
);

app.use(express.json({ limit: "100kb" }));

// تبدیل داده دیتابیس به قالب ثابت پاسخ API
function formatService(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    is_active: row.is_active,
    icon: row.icon || "activity",
    color: row.color || "blue",
    created_at: row.created_at,
  };
}

// بررسی سلامت سرور و دیتابیس
app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT current_database() AS database, NOW() AS server_time"
    );

    res.json({
      status: "ok",
      service: "Manora API",
      database: result.rows[0].database,
      databaseConnected: true,
      serverTime: result.rows[0].server_time,
    });
  } catch (error) {
    console.error("Database connection failed:", error.message);

    res.status(503).json({
      status: "error",
      service: "Manora API",
      databaseConnected: false,
      message: "اتصال به دیتابیس برقرار نشد.",
    });
  }
});

// دریافت خدمات
// حالت عادی: فقط خدمات فعال
// با includeInactive=true: تمام خدمات، شامل خدمات غیرفعال
app.get("/api/services", async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === "true";

    const result = await pool.query(
      `
        SELECT id, title, description, is_active, icon, color, created_at
        FROM services
        ${includeInactive ? "" : "WHERE is_active = TRUE"}
        ORDER BY id ASC
      `
    );

    res.json({
      status: "ok",
      count: result.rowCount,
      services: result.rows.map(formatService),
    });
  } catch (error) {
    console.error("Failed to fetch services:", error.message);

    res.status(500).json({
      status: "error",
      message: "دریافت خدمات با خطا مواجه شد.",
    });
  }
});

// افزودن خدمت جدید
app.post("/api/services", async (req, res) => {
  try {
    const {
      title,
      description = "",
      is_active = true,
      icon = "activity",
      color = "blue",
    } = req.body;

    if (typeof title !== "string" || !title.trim()) {
      return res.status(400).json({
        status: "error",
        message: "عنوان خدمت الزامی است.",
      });
    }

    if (
      typeof description !== "string" ||
      typeof is_active !== "boolean" ||
      typeof icon !== "string" ||
      typeof color !== "string"
    ) {
      return res.status(400).json({
        status: "error",
        message: "اطلاعات ارسالی معتبر نیست.",
      });
    }

    const result = await pool.query(
      `
        INSERT INTO services
          (title, description, is_active, icon, color)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, title, description, is_active, icon, color, created_at
      `,
      [
        title.trim(),
        description.trim(),
        is_active,
        icon,
        color,
      ]
    );

    res.status(201).json({
      status: "ok",
      service: formatService(result.rows[0]),
    });
  } catch (error) {
    console.error("Failed to create service:", error.message);

    res.status(500).json({
      status: "error",
      message: "افزودن خدمت با خطا مواجه شد.",
    });
  }
});

// ویرایش اطلاعات یا وضعیت یک خدمت
app.patch("/api/services/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!/^[1-9]\d*$/.test(id)) {
      return res.status(400).json({
        status: "error",
        message: "شناسه خدمت معتبر نیست.",
      });
    }

    const allowedFields = [
      "title",
      "description",
      "is_active",
      "icon",
      "color",
    ];

    const updates = [];
    const values = [];

    for (const field of allowedFields) {
      if (!Object.hasOwn(req.body, field)) continue;

      const value = req.body[field];

      if (field === "title") {
        if (typeof value !== "string" || !value.trim()) {
          return res.status(400).json({
            status: "error",
            message: "عنوان خدمت نمی‌تواند خالی باشد.",
          });
        }
        values.push(value.trim());
      } else if (field === "description") {
        if (typeof value !== "string") {
          return res.status(400).json({
            status: "error",
            message: "توضیحات معتبر نیست.",
          });
        }
        values.push(value.trim());
      } else if (field === "is_active") {
        if (typeof value !== "boolean") {
          return res.status(400).json({
            status: "error",
            message: "وضعیت خدمت معتبر نیست.",
          });
        }
        values.push(value);
      } else {
        if (typeof value !== "string" || !value.trim()) {
          return res.status(400).json({
            status: "error",
            message: `مقدار ${field} معتبر نیست.`,
          });
        }
        values.push(value.trim());
      }

      updates.push(`${field} = $${values.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "هیچ فیلدی برای ویرایش ارسال نشده است.",
      });
    }

    values.push(id);

    const result = await pool.query(
      `
        UPDATE services
        SET ${updates.join(", ")}
        WHERE id = $${values.length}
        RETURNING id, title, description, is_active, icon, color, created_at
      `,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        status: "error",
        message: "خدمت موردنظر پیدا نشد.",
      });
    }

    res.json({
      status: "ok",
      service: formatService(result.rows[0]),
    });
  } catch (error) {
    console.error("Failed to update service:", error.message);

    res.status(500).json({
      status: "error",
      message: "ویرایش خدمت با خطا مواجه شد.",
    });
  }
});

// حذف یک خدمت
app.delete("/api/services/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!/^[1-9]\d*$/.test(id)) {
      return res.status(400).json({
        status: "error",
        message: "شناسه خدمت معتبر نیست.",
      });
    }

    const result = await pool.query(
      "DELETE FROM services WHERE id = $1 RETURNING id",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        status: "error",
        message: "خدمت موردنظر پیدا نشد.",
      });
    }

    res.json({
      status: "ok",
      message: "خدمت با موفقیت حذف شد.",
      id: result.rows[0].id,
    });
  } catch (error) {
    console.error("Failed to delete service:", error.message);

    res.status(500).json({
      status: "error",
      message: "حذف خدمت با خطا مواجه شد.",
    });
  }
});

// مدیریت خطاهای JSON نامعتبر
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({
      status: "error",
      message: "ساختار اطلاعات ارسالی معتبر نیست.",
    });
  }

  next(error);
});

// شروع سرور
const server = app.listen(PORT, () => {
  console.log(`Manora API running at http://localhost:${PORT}`);
});

// بستن صحیح اتصال‌ها هنگام توقف سرور
let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log("Shutting down Manora API...");

  server.close(async () => {
    try {
      await pool.end();
      process.exit(0);
    } catch (error) {
      console.error("Error closing PostgreSQL pool:", error.message);
      process.exit(1);
    }
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);