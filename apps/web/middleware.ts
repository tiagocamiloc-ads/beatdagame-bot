export { default } from "next-auth/middleware";

export const config = {
  // Protect everything except the login page, NextAuth's own routes, and
  // static assets. The publish/scrape API routes below are also excluded
  // deliberately: those are read/write endpoints only ever called by the
  // authenticated board UI itself, so this matcher just needs to gate page
  // navigation and the /api/articles data routes.
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
