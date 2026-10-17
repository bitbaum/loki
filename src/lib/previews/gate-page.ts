/**
 * The page a visitor sees before entering the access code, and the page that
 * says previews are switched off. The frame (and every colour) is
 * lib/previews/page-shell, shared with the before-and-after tour.
 */
import { esc, previewShell as shell } from "@/lib/previews/page-shell";

/**
 * Ask for the code. The script posts it and reloads the same address, which
 * keeps the `#loki-owner=…` fragment the link may carry — a plain form post
 * would drop it, and with it the person's right to have their notes built.
 *
 * The gate does not say whose site this is: a preview is client work, and
 * every address under /p/ answers before any code is checked, so a name here
 * would tell anyone guessing addresses who the studio is talking to.
 */
export function previewGatePage(opts: { postUrl: string; error?: string }): string {
  return shell(
    "A private site",
    `<div style="display:grid;gap:8px">
  <h1>This site is private for now</h1>
  <p>Enter the access code you were sent to open it.</p>
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
