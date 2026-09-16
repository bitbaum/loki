import { fleetSurfaceHref, projectFromFleetRoute } from "@/lib/fleet-context";

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

console.log("✓ fleet-context tests passed");
