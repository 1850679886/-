import path from "node:path";
import fs from "node:fs/promises";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueDevTools from "vite-plugin-vue-devtools";
import tailwindcss from "@tailwindcss/vite";
import VueRouter from "vue-router/vite";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";

const publishedBinDataFiles = new Set(["TYPE_DICTIONARY.json"]);

function pruneUnpublishedBinData() {
    return {
        name: "prune-unpublished-bin-data",
        async closeBundle() {
            const binDataDir = path.resolve(__dirname, "dist/data/BinData");

            try {
                const entries = await fs.readdir(binDataDir, {
                    withFileTypes: true,
                });

                await Promise.all(
                    entries.map(async (entry) => {
                        if (
                            entry.isFile() &&
                            !publishedBinDataFiles.has(entry.name)
                        ) {
                            await fs.unlink(path.join(binDataDir, entry.name));
                        }
                    }),
                );
            } catch (error) {
                if (
                    error instanceof Error &&
                    "code" in error &&
                    error.code === "ENOENT"
                ) {
                    return;
                }

                throw error;
            }
        },
    };
}

// https://vite.dev/config/
export default defineConfig({
    plugins: [
        vue(),
        vueDevTools(),
        tailwindcss(),
        VueRouter({
            // Recommended: auto-included by tsconfig
            dts: "src/typed-router.d.ts",
        }),
        AutoImport({
            imports: ["vue", "vue-router", "@vueuse/core", "pinia"],
            dts: "src/auto-imports.d.ts",
        }),
        Components({
            dirs: ["src/components/ui", "src/components"],
            resolvers: [
                (name) => {
                    if (name.startsWith("Icon")) {
                        return {
                            name: name.slice(4),
                            from: "lucide-vue-next",
                        };
                    }
                },
            ],
            dts: "src/components.d.ts",
        }),
        pruneUnpublishedBinData(),
    ],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
});
