import {
  asFleetProject,
  fleetSurfaceHref,
  projectFromFleetRoute,
  withTerminalView,
} from "@/lib/fleet-context";

const project = "BiasLens alpha";
if (fleetSurfaceHref("profile", project) !== "/projects?project=BiasLens%20alpha") {
  throw new Error("profile deep link");
}
if (fleetSurfaceHref("chat", project) !== "/loki?project=BiasLens%20alpha") {
  throw new Error("chat deep link");
}
if (fleetSurfaceHref("control", project) !== "/control?focus=BiasLens%20alpha") {
  throw new Error("control deep link");
}
if (fleetSurfaceHref("terminal", project) !== "/terminal?project=BiasLens%20alpha") {
  throw new Error("terminal deep link");
}
if (
  fleetSurfaceHref("terminal", project, "cloud", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") !==
  "/terminal?project=BiasLens%20alpha&source=cloud&run=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
) {
  throw new Error("terminal run deep link");
}
if (projectFromFleetRoute("/terminal", new URLSearchParams("project=BiasLens")) !== "BiasLens") {
  throw new Error("terminal route context");
}
if (projectFromFleetRoute("/terminal", new URLSearchParams("tab=BiasLens")) !== "BiasLens") {
  throw new Error("legacy terminal route context");
}
if (projectFromFleetRoute("/projects", new URLSearchParams("project=BiasLens+alpha")) !== project) {
  throw new Error("profile route context");
}
if (projectFromFleetRoute("/projects", new URLSearchParams("open=123")) !== null) {
  throw new Error("catalog must not masquerade as workspace context");
}

// A parallel run's tab is a lane of a project, never the project: the strip
// showed "skif~d0a14b69" on every page (2026-09-25).
if (projectFromFleetRoute("/terminal", new URLSearchParams("tab=skif~d0a14b69")) !== "skif") {
  throw new Error("a lane tab in the URL must read as its project");
}
if (
  asFleetProject("  Skif~d0a14b69 ") !== "Skif" ||
  asFleetProject("") !== null ||
  asFleetProject(null) !== null
) {
  throw new Error("asFleetProject must strip the lane and treat blanks as none");
}

// Watch links name the view they open: the agent's conversation or the raw PTY.
if (
  withTerminalView("/terminal?project=a%20b&run=r1", "chat") !==
  "/terminal?project=a%20b&run=r1&view=chat"
) {
  throw new Error("withTerminalView must append the view and keep the encoding");
}
if (
  withTerminalView("/terminal?view=chat&project=a", "terminal") !==
  "/terminal?project=a&view=terminal"
) {
  throw new Error("withTerminalView must replace an existing view");
}
if (withTerminalView("/terminal", "chat") !== "/terminal?view=chat") {
  throw new Error("withTerminalView on a bare path");
}

console.log("✓ fleet-context tests passed");
