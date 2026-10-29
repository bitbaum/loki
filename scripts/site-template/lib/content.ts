import { join } from "node:path";
import { readCollection, readEntry } from "bip-kit/node";
const folder = join(process.cwd(), "content", "blog");
export const publishedPosts = () => readCollection(folder);
export const publishedPost = (slug: string) => readEntry(folder, slug);
