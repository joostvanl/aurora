import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpContext } from "../client.js";
import { toolError, toolOk } from "../errors.js";

export function registerPackageTools(server: McpServer, ctx: McpContext) {
  const { client } = ctx;

  server.tool(
    "export_package",
    "Export content types/forms/media as a ZIP to a local file path.",
    {
      outPath: z.string().min(1),
      contentTypeApiIds: z.array(z.string()).optional(),
      formApiIds: z.array(z.string()).optional(),
      includeMedia: z.boolean().optional(),
    },
    async ({ outPath, ...input }) => {
      try {
        const { writeFile } = await import("node:fs/promises");
        const { blob, filename } = await client.exportPackage(input);
        const ab = await blob.arrayBuffer();
        await writeFile(outPath, Buffer.from(ab));
        return toolOk({
          ok: true,
          outPath,
          filename,
          bytes: ab.byteLength,
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "import_package",
    "Import a ZIP package from a local file path into the authenticated website.",
    {
      filePath: z.string().min(1),
      mode: z.enum(["overwrite", "skip"]).default("skip"),
    },
    async ({ filePath, mode }) => {
      try {
        const { readFile } = await import("node:fs/promises");
        const path = await import("node:path");
        const buf = await readFile(filePath);
        const file = new File([buf], path.basename(filePath), {
          type: "application/zip",
        });
        return toolOk(
          await client.importPackage(file, {
            mode,
            filename: path.basename(filePath),
          }),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
