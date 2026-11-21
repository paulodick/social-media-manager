import { redirect } from "next/navigation";
import { hasPassword, isAuthed } from "@/lib/auth";
import { setupPassword } from "@/lib/actions";
import { MIN_PASSWORD } from "@/lib/password";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  if (await isAuthed()) redirect("/");
  if (await hasPassword()) redirect("/login");
  const { erro } = await searchParams;
  return (
    <main id="conteudo" tabIndex={-1} className="login">
      <form action={setupPassword} className="card">
        <div className="col">
          <h1>Primeiro acesso</h1>
          <p className="muted">
            Ainda não existe uma senha. Escolha a senha de acesso do app agora: quem abrir esta tela primeiro define a senha.
          </p>
        </div>
        {erro && <p className="alert err" role="alert">{erro.slice(0, 200)}</p>}
        <div className="col">
          <label className="f" htmlFor="senha">Nova senha</label>
          <input id="senha" name="senha" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required autoFocus />
          <p className="muted">Pelo menos {MIN_PASSWORD} caracteres.</p>
        </div>
        <div className="col">
          <label className="f" htmlFor="confirma">Repita a senha</label>
          <input id="confirma" name="confirma" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required />
        </div>
        <button className="btn primary" type="submit">Definir senha e entrar</button>
      </form>
    </main>
  );
}
