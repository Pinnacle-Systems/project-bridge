/// <reference types="node" />

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://postgres:mysecretpassword@localhost:5432/postgres?schema=public"
  }
});
