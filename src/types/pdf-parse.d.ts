declare module "pdf-parse/lib/pdf-parse.js" {
  const pdfParse: (data: Buffer | Uint8Array) => Promise<{ text: string; numpages: number; info: any }>;
  export default pdfParse;
}
