# Operating contract — agents running on the Loki box

Org rules are [bitbaum/fleet AGENTS.md](https://github.com/bitbaum/fleet/blob/main/AGENTS.md): packages by default (say why if you skip one), search through `@bitbaum/searchkit`, chat through `@bitbaum/chatkit`, shared names and the identity contract. Read that file. Do not restate it here.


You are running on the always-on box (bitbaum), not on the operator's laptop.
Everything below follows from that one fact.

## Your work is invisible until you push

The operator cannot see this filesystem. No editor is open on it. A change you
make in `~/dev/<project>` and leave uncommitted does not exist as far as anyone
is concerned — and the next dispatch may clone over it or reset the checkout.

**Pushing is not the last step of the task. It is the only step that delivers
it.** A perfect change that is still sitting in this working tree is a failed
dispatch.

Before you finish, every time:

1. `git status` — the tree must be clean. Untracked files count.
2. Commit each logical unit with a real message (`<type>(<scope>): <what>`).
3. Push the branch to `origin`.
4. Open a PR (`gh pr create`), or a draft PR if it is not ready for review.
5. State the branch name and PR URL in your final message.

If you cannot push (no credentials, network failure), **say so loudly in your
final message** and name the branch and commit SHA so the work can be recovered.
Never end a session reporting success on work that never left this machine.

## Branch, never commit to the default branch

Create a branch before your first commit. Never commit directly to `main` /
`master`, never force-push, never delete branches you did not create, and never
press merge yourself. Instead, enable auto-merge on the PR you open
(`gh pr merge --auto --squash`): this machine is unattended, so the second pair
of eyes is the pipeline — CI runs the repo's own `verify`, a green PR merges by
itself and the deploy follows. A red PR stays open; say so in your final message
and name what is red.

Some checkouts under `~/dev` are stale clones whose local `main` has diverged
from the remote. Do not try to reconcile them. Branch from `origin/<default>`:

    git fetch origin && git checkout -b <branch> origin/main

## This machine serves production

The box hosts the live sites for ~20 projects under `/opt`. Those paths are
blocked from this process by the systemd unit, and that is deliberate — do not
look for a way around it. Do not restart services, edit anything under `/opt`,
touch Caddy, or run migrations against a production database. If a task appears
to require any of that, stop and report it instead of doing it.

## Scope

Do the task you were dispatched to do. This is an unattended session: there is
nobody to ask a clarifying question, so if the task is ambiguous, pick the
reading a careful colleague would, state the assumption in your final message,
and deliver the whole thing under it. Do not expand scope on your own judgment —
an unsupervised agent widening its own remit is how a small dispatch becomes an
unreviewable diff.
