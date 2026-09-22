import dns from "dns/promises";
import net from "net";

/**
 * Checks if an IPv4 address is in a private, loopback, or link-local range.
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return true;

  const [a, b] = parts;

  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;

  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;

  // 10.0.0.0/8 (Private)
  if (a === 10) return true;

  // 172.16.0.0/12 (Private: 172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16 (Private)
  if (a === 192 && b === 168) return true;

  // 169.254.0.0/16 (Link-local / AWS / GCP cloud metadata)
  if (a === 169 && b === 254) return true;

  // 100.64.0.0/10 (Carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // Broadcast
  if (parts[0] === 255 && parts[1] === 255 && parts[2] === 255 && parts[3] === 255) return true;

  return false;
}

/**
 * Checks if an IPv6 address is in a private, loopback, or link-local range.
 */
function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // Loopback (::1)
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;

  // Unspecified (::)
  if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return true;

  // IPv4-mapped IPv6 (::ffff:127.0.0.1)
  if (normalized.startsWith("::ffff:")) {
    const ipv4Part = normalized.slice(7);
    if (net.isIPv4(ipv4Part)) {
      return isPrivateIPv4(ipv4Part);
    }
  }

  // Unique local addresses (fc00::/7 -> fc00:: to fdff::)
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;

  // Link-local addresses (fe80::/10 -> fe80:: to febf::)
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }

  return false;
}

/**
 * Validates whether a target URL is safe to fetch and not pointing to internal/private infrastructure.
 * Rejects metadata services (169.254.169.254), loopback (localhost, 127.0.0.1), and RFC1918 subnets.
 */
export async function assertSafeUrl(urlString: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(`Invalid URL: "${urlString}"`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Forbidden protocol "${parsed.protocol}". Only HTTP and HTTPS are permitted.`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Known metadata / loopback hostnames
  if (
    hostname === "localhost" ||
    hostname === "metadata.google.internal" ||
    hostname === "instance-data" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".local")
  ) {
    throw new Error(`Access to local or cloud internal hostname "${hostname}" is forbidden.`);
  }

  // If directly an IP address
  if (net.isIPv4(hostname)) {
    if (isPrivateIPv4(hostname)) {
      throw new Error(`Access to private/internal IPv4 address "${hostname}" is blocked.`);
    }
    return parsed;
  }

  if (net.isIPv6(hostname)) {
    if (isPrivateIPv6(hostname)) {
      throw new Error(`Access to private/internal IPv6 address "${hostname}" is blocked.`);
    }
    return parsed;
  }

  // Resolve hostname via DNS to protect against DNS rebinding / host spoofing
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      throw new Error(`Could not resolve hostname "${hostname}".`);
    }

    for (const addr of addresses) {
      if (addr.family === 4 && isPrivateIPv4(addr.address)) {
        throw new Error(`Hostname "${hostname}" resolved to blocked private address "${addr.address}".`);
      }
      if (addr.family === 6 && isPrivateIPv6(addr.address)) {
        throw new Error(`Hostname "${hostname}" resolved to blocked private address "${addr.address}".`);
      }
    }
  } catch (err: any) {
    if (err.message.includes("blocked") || err.message.includes("forbidden")) {
      throw err;
    }
    throw new Error(`DNS lookup failed for "${hostname}": ${err.message}`);
  }

  return parsed;
}
