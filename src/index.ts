
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fetch from "node-fetch";

import { z } from "zod";

export enum TrustFactorKey {
  CMP09_complianceSOC_2 = "CMP09_complianceSOC_2",
  CMP06_complianceISO_27001 = "CMP06_complianceISO_27001",
  PRV01_dataProtection = "PRV01_dataProtection",
  CMP19_complianceCSAStarCert = "CMP19_complianceCSAStarCert",
  CMP18_complianceFedRAMP = "CMP18_complianceFedRAMP",
  IDD01_iddIntegrationPlatform = "IDD01_iddIntegrationPlatform",
  SEC28_securityPenTest = "SEC28_securityPenTest",
  CMP04_complianceHIPAA = "CMP04_complianceHIPAA",
  CMP22_complianceISO_27017 = "CMP22_complianceISO_27017",
  CMP16_complianceISO_27018 = "CMP16_complianceISO_27018",
  SEC33_complianceVulnerabilityScanning = "SEC33_complianceVulnerabilityScanning",
  CMP25_complianceCOPPA = "CMP25_complianceCOPPA",
}

let trustCatalogCache: any[] | null = null;

async function fetchTrustCatalog(): Promise<any[]> {
  if (trustCatalogCache) return trustCatalogCache;
  const response = await fetch(
    "https://res.cdn.office.net/s01-apptrustcatalog/1httl/2025/09/15/trustCatalogDetails.json"
  );
  if (!response.ok) throw new Error("Failed to fetch catalog");
  trustCatalogCache = (await response.json()) as any[];
  return trustCatalogCache;
}

// Create server instance
const server = new McpServer({
  name: "myMcpServer",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Register trust filter tool
server.tool(
  "get-appsWithTrustFilter",
  "Get app IDs matching a trust factor key",
  {
    trustFactorKey: z
      .nativeEnum(TrustFactorKey)
      .describe("Trust factor key to filter apps by"),
  },
  async ({ trustFactorKey }) => {
    const catalog = await fetchTrustCatalog();
    const matchingApps = catalog
      .filter(
        (item: any) =>
          Array.isArray(item.TrustFactors) &&
          item.TrustFactors.includes(trustFactorKey)
      )
      .map((item: any) => item.TeamsAppId || item.OfficeAssetId)
      .filter(Boolean);
    return {
      content: [
        {
          type: "text",
          text: matchingApps.length
            ? `Matching App IDs for ${trustFactorKey}:\n${matchingApps.join(
                "\n"
              )}`
            : `No apps found with trust factor: ${trustFactorKey}`,
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Trust Catalog MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});



