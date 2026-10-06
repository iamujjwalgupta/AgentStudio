/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "mammoth", "pg", "nodemailer", "bcryptjs", "docx", "exceljs", "pdfkit", "pptxgenjs", "@duckdb/node-api", "@duckdb/node-bindings"],
  },
};
export default nextConfig;
