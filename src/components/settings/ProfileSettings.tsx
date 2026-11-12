"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, ExternalLink, Check } from "lucide-react";
import { patchJson, throwApiError } from "@/lib/api/fetch";
import { normalizeUsername } from "@/lib/username";
import { APP_DOMAIN } from "@/config/brand";
import { Avatar } from "@/components/shared/Avatar";

type Props = {
  user: { id: string; name: string; username: string; image: string };
};

/** What the API accepts — stated here because the user has to satisfy it. */
const USERNAME_RULE = "Lowercase letters, numbers and hyphens. 2–40 characters.";

export function ProfileSettings({ user }: Props) {
  const router = useRouter();
  // The saved values, as a baseline `dirty` can be measured against. This was
  // the `user` PROP, which a successful PATCH never refreshes — so after one
  // save the form compared against a stale baseline forever and the button
  // stayed enabled, claiming unsaved work that had already been saved.
  const [saved, setSaved] = useState({ name: user.name, username: user.username });
  const [name, setName] = useState(user.name);
  const [username, setUsername] = useState(user.username);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [justSaved, setJustSaved] = useState(false);

  // The username is STORED normalized, so that is what `dirty` and the public
  // link must both reason about — comparing the raw field would call "Cato"
  // and "cato" different values when they save identically.
  const normalized = normalizeUsername(username);
  const dirty = name !== saved.name || normalized !== saved.username;
  // Typing is never blocked; the user is told what will actually be stored.
  const willRename = Boolean(username) && normalized !== username.trim();
  const tooShort = Boolean(username) && normalized.length < 2;

  const save = async () => {
    setSaving(true);
    setError("");
    setJustSaved(false);
    try {
      const res = await patchJson("/api/me", { name, username: normalized });
      if (!res.ok) await throwApiError(res, "Failed to save");
      // Show what was actually stored, not what was typed, and move the
      // baseline so the button can go quiet again.
      setUsername(normalized);
      setSaved({ name, username: normalized });
      setJustSaved(true);
      // Anything server-rendered from the session — the public profile, any
      // surface that greets you by name — is now stale.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="ui-settings-section">
      <Avatar src={user.image} name={name} size="md" />

      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="ui-kicker" htmlFor="profile-display-name">
            Display name
          </label>
          <input
            id="profile-display-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setJustSaved(false);
            }}
            className="ui-input"
            placeholder="Your name"
          />
        </div>
        <div className="space-y-1.5">
          <label className="ui-kicker" htmlFor="profile-username">
            Username
          </label>
          <div className="flex items-center gap-2 rounded-lg border border-border-default bg-surface-base px-3 py-2.5">
            {/* The full host is 26 characters of prefix. On a 390px phone that
                left ~120px for the field the user is actually here to edit,
                and the input overflowed the border. The domain is implied on
                your own settings page — the phone gets the path alone. */}
            <span className="shrink-0 text-sm text-text-tertiary">
              <span className="hidden sm:inline">{APP_DOMAIN}</span>/u/
            </span>
            <input
              id="profile-username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setJustSaved(false);
              }}
              aria-describedby="profile-username-rule"
              className="ui-tap w-full min-w-0 flex-1 bg-transparent text-base text-text-primary outline-none placeholder:text-text-muted sm:text-sm"
              placeholder="yourname"
            />
          </div>
          {/* The rule, always. It used to live only in the API's zod schema, so
              the first a user heard of it was a rejected save — or worse, a
              silent rewrite they never saw: the form kept showing what they
              typed while the server stored something else. */}
          <p id="profile-username-rule" className="text-xs text-text-tertiary">
            {tooShort ? (
              <span className="text-status-negative">
                Too short — a username needs at least 2 characters.
              </span>
            ) : willRename ? (
              <>
                Will be saved as <span className="font-mono text-text-secondary">{normalized}</span>
                . {USERNAME_RULE}
              </>
            ) : (
              USERNAME_RULE
            )}
          </p>
          {normalized && !tooShort && (
            <Link
              href={`/u/${normalized}`}
              target="_blank"
              className="ui-tap inline-flex items-center gap-1 text-xs text-accent-text hover:text-accent-hover transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              View public profile
            </Link>
          )}
        </div>
      </div>

      {error && <p className="ui-error">{error}</p>}

      {/* Status sits BESIDE the button rather than above it: as a block it
          pushed the button down on every save, moving the target the user had
          just aimed at. */}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving || !dirty || tooShort} className="ui-btn-primary">
          {saving && <Loader2 className="ui-spinner" />}
          Save changes
        </button>
        <p role="status" aria-live="polite" className="text-sm text-text-secondary">
          {justSaved && !dirty && (
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-4 w-4 text-status-positive" />
              Saved
            </span>
          )}
        </p>
      </div>
    </section>
  );
}
