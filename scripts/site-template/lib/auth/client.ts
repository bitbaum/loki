"use client";
import { createAuthClient } from "better-auth/react";
import { authClientPlugins } from "@bitbaum/accountkit/auth/client";
export const authClient = createAuthClient({ plugins: authClientPlugins() });
