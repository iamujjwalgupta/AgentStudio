/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "mammoth", "pg", "nodemailer", "bcryptjs", "docx"],
  },
};
export default nextConfig;
