import { defineConfig } from "drizzle-kit";
export default defineConfig({
    schema: "./src/db/schema.ts",
    out: "./drizzle/migrations",
    dialect: "sqlite",
    dbCredentials: {
        url: "file:./sweteam.db",
    },
});
//# sourceMappingURL=drizzle.config.js.map