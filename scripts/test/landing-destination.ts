/**
 * Inline self-tests for the "/" destination rule.
 * Run: npm run test:landing-destination
 *
 * The regression this guards: Fleet Runner opens at OS startup and loads
 * APP_URL with no path. Before this rule the owner's first screen every
 * morning was the marketing hero instead of the command deck. Nothing else
 * in the suite would notice if that came back.
 */
import { landingRedirect } from "@/lib/landing-destination";
import { ROUTES } from "@/config/auth";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function runTests(): void {
  let passed = 0;
  const check = (label: string, fn: () => void) => {
    fn();
    passed += 1;
    console.log(`  ✓ ${label}`);
  };

  check("signed-in operator inside Fleet Runner lands on the command deck", () => {
    const to = landingRedirect({ insideRunner: true, signedIn: true, params: {} });
    assert(to === ROUTES.RUNNER_HOME, `expected ${ROUTES.RUNNER_HOME}, got ${to}`);
  });

  check("the command deck is a real app route, not the marketing home", () => {
    assert(ROUTES.RUNNER_HOME !== ROUTES.HOME, "RUNNER_HOME must not be the landing page");
    assert(ROUTES.RUNNER_HOME.startsWith("/"), "RUNNER_HOME must be a path");
  });

  check("a signed-in browser lands in the app, not on the pitch", () => {
    const to = landingRedirect({ insideRunner: false, signedIn: true, params: {} });
    assert(to === ROUTES.APP_HOME, `expected ${ROUTES.APP_HOME}, got ${to}`);
  });

  check("a signed-out browser still gets the marketing page", () => {
    assert(
      landingRedirect({ insideRunner: false, signedIn: false, params: {} }) === null,
      "signed-out browser must not redirect",
    );
  });

  check("?site opens the real homepage for a signed-in browser too", () => {
    assert(
      landingRedirect({ insideRunner: false, signedIn: true, params: { site: "1" } }) === null,
      "?site must not redirect",
    );
  });

  check("signed-out runner still gets the pitch and the sign-in path", () => {
    assert(
      landingRedirect({ insideRunner: true, signedIn: false, params: {} }) === null,
      "signed-out must not redirect",
    );
  });

  check("?site opens the real homepage from inside the runner", () => {
    assert(
      landingRedirect({ insideRunner: true, signedIn: true, params: { site: "" } }) === null,
      "?site must not redirect",
    );
    assert(
      landingRedirect({ insideRunner: true, signedIn: true, params: { site: "1" } }) === null,
      "?site=1 must not redirect",
    );
  });

  check("an unrelated query param does not open the escape hatch", () => {
    const to = landingRedirect({ insideRunner: true, signedIn: true, params: { ref: "email" } });
    assert(to === ROUTES.RUNNER_HOME, "only the site param is an escape hatch");
  });

  console.log(`\n${passed} landing-destination checks passed`);
}

runTests();
