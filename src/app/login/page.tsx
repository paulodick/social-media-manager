import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";
import { login } from "@/lib/actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  if (await isAuthed()) redirect("/");
  const { erro } = await searchParams;
  return (
    <main className="login">
      <form action={login} className="card">
        <div className="col">
          <h1>Social Media Manager</h1>
          <p className="muted">Entre com a senha de acesso.</p>
        </div>
        {erro && <p className="alert err" role="alert">Senha incorreta.</p>}
        <div className="col">
          <label className="f" htmlFor="senha">Senha</label>
          <input id="senha" name="senha" type="password" autoComplete="current-password" required autoFocus />
        </div>
        <button className="btn primary" type="submit">Entrar</button>
      </form>
    </main>
  );
}
