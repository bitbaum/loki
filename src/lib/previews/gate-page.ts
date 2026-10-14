/**
 * The page a visitor sees before entering the access code, and the page that
 * says previews are switched off. Plain HTML, because a preview route answers
 * with the prospect's own files and has no React tree to render into.
 *
 * Colours come from PALETTE.widget, which is generated from
 * @bitbaum/design-tokens: no colour is typed here.
 */
import { PALETTE } from "@/lib/palette";

function esc(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function shell(title: string, body: string): string {
  const t = PALETTE.widget;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{display:grid;place-items:center;padding:24px 16px;background:${t.surface};color:${t.text};font:400 16px/1.55 ${t.fontSans}}
main{width:min(100%,400px);display:grid;gap:20px}
h1{margin:0;font-size:24px;font-weight:600;line-height:1.25}
p{margin:0;color:${t.textSecondary}}
form{display:grid;gap:10px}
label{font:500 12px ${t.fontMono};letter-spacing:.08em;text-transform:uppercase;color:${t.textTertiary}}
.row{display:flex;gap:8px}
input{flex:1;min-width:0;height:48px;padding:0 14px;border:1px solid ${t.borderDark};border-radius:${t.radiusControl};background:${t.surfaceRaised};color:${t.text};font:500 18px ${t.fontMono};letter-spacing:.1em}
input:focus{outline:2px solid ${t.accent};outline-offset:1px}
button{height:48px;padding:0 20px;border:0;border-radius:${t.radiusControl};background:${t.accent};color:${t.inkOnAccent};font:600 15px ${t.fontSans};cursor:pointer}
button:disabled{opacity:.6;cursor:progress}
button:focus-visible{outline:2px solid ${t.text};outline-offset:2px}
.msg{min-height:1.5em;font-size:14px;color:${t.textSecondary}}
.msg.err{color:${t.error}}
</style></head><body><main>${body}</main></body></html>`;
}

/**
 * Ask for the code. The script posts it and reloads the same address, which
 * keeps the `#loki-owner=…` fragment the link may carry — a plain form post
 * would drop it, and with it the person's right to have their notes built.
 */
export function previewGatePage(opts: { name: string; postUrl: string; error?: string }): string {
  return shell(
    `${opts.name}`,
    `<div style="display:grid;gap:8px">
  <h1>${esc(opts.name)}</h1>
  <p>This site is private for now. Enter the access code you were sent to open it.</p>
</div>
<form id="gate" method="post" action="${esc(opts.postUrl)}" autocomplete="off">
  <label for="code">Access code</label>
  <div class="row">
    <input id="code" name="code" required autocapitalize="none" spellcheck="false" aria-describedby="msg">
    <button id="go" type="submit">Open</button>
  </div>
  <p class="msg${opts.error ? " err" : ""}" id="msg" role="status">${esc(opts.error ?? "")}</p>
</form>
<script>
(function(){
  var form=document.getElementById("gate"),input=document.getElementById("code"),btn=document.getElementById("go"),msg=document.getElementById("msg");
  input.focus();
  form.addEventListener("submit",function(e){
    e.preventDefault();
    btn.disabled=true;msg.className="msg";msg.textContent="Opening…";
    fetch(form.action,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:input.value}),credentials:"same-origin"})
      .then(function(r){return r.json().catch(function(){return {};}).then(function(b){return {ok:r.ok,b:b};});})
      .then(function(res){
        if(res.ok){location.reload();return;}
        btn.disabled=false;msg.className="msg err";
        msg.textContent=(res.b&&res.b.error)||"That did not work. Try again.";
        input.select();
      })
      .catch(function(){btn.disabled=false;msg.className="msg err";msg.textContent="Could not reach the server. Check your connection and try again.";});
  });
})();
</script>`,
  );
}

/** No access code is set yet (or previews are off here): say so, and to whom. */
export function previewsOffPage(): string {
  return shell(
    "Not open yet",
    `<h1>This site is not open yet</h1>
<p>It is being set up. If you were sent this link, reply to the person who sent it and they will open it for you.</p>`,
  );
}

/** No preview at this address. */
export function previewNotFoundPage(): string {
  return shell(
    "Nothing here",
    `<h1>There is no site here</h1>
<p>Check the link you were sent. If it came from us, reply and we will send the right one.</p>`,
  );
}
