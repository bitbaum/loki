import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, newNonce, SECURITY_HEADERS } from "./security";

const directives = (csp: string) =>
  new Map(
    csp.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values.join(" ")] as const;
    }),
  );

describe("contentSecurityPolicy", () => {
  const nonce = newNonce();
  const csp = directives(contentSecurityPolicy(nonce));

  it("runs only scripts carrying this response's nonce", () => {
    expect(csp.get("script-src")).toBe(`'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(csp.get("script-src")).not.toContain("unsafe-inline");
    expect(csp.get("script-src")).not.toContain("unsafe-eval");
  });

  it("sends data only to this origin", () => {
    expect(csp.get("connect-src")).toBe("'self'");
  });

  it("cannot be framed, embeds nothing, posts forms only here", () => {
    expect(csp.get("frame-ancestors")).toBe("'none'");
    expect(csp.get("frame-src")).toBe("'none'");
    expect(csp.get("object-src")).toBe("'none'");
    expect(csp.get("base-uri")).toBe("'self'");
    expect(csp.get("form-action")).toBe("'self'");
    expect(csp.get("default-src")).toBe("'self'");
  });

  it("opens only Loki, and only when the widget is on", () => {
    const withWidget = directives(contentSecurityPolicy(nonce, { widget: true }));
    expect(withWidget.get("connect-src")).toBe("'self' https://loki.orangecat.ch");
    expect(withWidget.get("frame-src")).toBe("https://loki.orangecat.ch");
  });

  it("allows eval only in development", () => {
    const dev = directives(contentSecurityPolicy(nonce, { dev: true }));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
  });

  it("refuses a nonce that could break out of the header", () => {
    expect(() => contentSecurityPolicy("abc'; script-src *")).toThrow();
    expect(() => contentSecurityPolicy("")).toThrow();
  });
});

describe("newNonce", () => {
  it("is fresh every time", () => {
    const seen = new Set(Array.from({ length: 50 }, newNonce));
    expect(seen.size).toBe(50);
  });
});

describe("SECURITY_HEADERS", () => {
  const headers = new Map(SECURITY_HEADERS.map(({ key, value }) => [key.toLowerCase(), value]));

  it("pins HTTPS for two years", () => {
    expect(headers.get("strict-transport-security")).toMatch(/max-age=63072000/);
    expect(headers.get("strict-transport-security")).toMatch(/includeSubDomains/);
  });

  it("sends no referrer and refuses framing and sniffing", () => {
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("switches off camera, microphone, location and payment", () => {
    const policy = headers.get("permissions-policy") ?? "";
    for (const feature of ["camera", "microphone", "geolocation", "payment"]) {
      expect(policy).toContain(`${feature}=()`);
    }
    // Passkeys must keep working.
    expect(policy).not.toContain("publickey-credentials");
  });
});
