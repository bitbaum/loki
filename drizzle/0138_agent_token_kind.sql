-- What a ck_ token may do. "runner": everything a builder does (claim and ack
-- commands, post a PTY's frames, transcript, runtime state, run progress) and
-- everything an agent does. "agent": drive sessions, never act as a builder.
--
-- Every existing token keeps "runner": tokens were minted for builders or
-- with a builder's powers, and a running builder must not lose its token on
-- deploy. Constant default, so Postgres adds the column without a rewrite.

ALTER TABLE "agent_tokens" ADD COLUMN "kind" text DEFAULT 'runner' NOT NULL;