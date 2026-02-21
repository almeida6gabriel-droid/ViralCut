import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

const hasGoogle = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const providers: any[] = [
  Credentials({
    id: "demo",
    name: "Demo Login",
    credentials: {
      email: { label: "Email", type: "email" },
    },
    async authorize(credentials) {
      const email = typeof credentials?.email === "string" ? credentials.email : "demo@viralcut.ai";
      return {
        id: "demo-user",
        name: "Creator Demo",
        email,
      };
    },
  }),
];

if (hasGoogle) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    })
  );
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers,
  pages: {
    signIn: "/",
  },
  session: {
    strategy: "jwt",
  },
});

export const googleLoginConfigured = hasGoogle;
