/** scripts/build-widget-chat.ts inlines chatkit's stylesheet as text. */
declare module "@bitbaum/chatkit/styles.css" {
  const css: string;
  export default css;
}
