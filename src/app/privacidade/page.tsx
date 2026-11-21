import Link from "next/link";

// Lê a variável de ambiente a cada pedido (sem isso a página sairia pronta da compilação, sem o e-mail).
export const dynamic = "force-dynamic";

export const metadata = { title: "Política de Privacidade · Social Media Manager" };

// Página pública (fica fora do grupo (app), então não pede login). O endereço é o que a Meta pede no cadastro do app.
export default function Privacidade() {
  const contato = process.env.PRIVACY_CONTACT_EMAIL?.trim();
  return (
    <main id="conteudo" tabIndex={-1} className="legal">
      <h1>Política de Privacidade</h1>
      <p className="muted">Social Media Manager (app.ebuks.com.br) · atualizada em 21/11/2026</p>

      <h2>O que é este aplicativo</h2>
      <p>
        O Social Media Manager é uma ferramenta de uso restrito para planejar, escrever e publicar posts em redes sociais de empresas
        clientes. Não há cadastro aberto ao público: o acesso é feito por senha, por quem administra o aplicativo, em nome das
        empresas atendidas. Quem tem a Página ou a conta profissional conectada continua sendo o dono dela.
      </p>

      <h2>Quais dados usamos</h2>
      <ul>
        <li>
          <b>Cadastro da empresa cliente:</b> nome, segmento, site, tom de voz, observações de marca e os endereços das redes sociais.
        </li>
        <li>
          <b>Planejamento e posts:</b> ideias, legendas, títulos, datas e horários, e o link do arquivo de mídia no Google Drive da
          empresa. Os arquivos continuam no Google Drive; o aplicativo só os lê (e cria pastas) e não os move nem apaga.
        </li>
        <li>
          <b>Conexão com Facebook e Instagram (quando a empresa autoriza):</b> o nome e o identificador da Página do Facebook e da
          conta profissional do Instagram ligada a ela, e o token de acesso que a Meta entrega para publicar. O token fica
          criptografado no banco de dados e nunca é exibido nem registrado nos logs.
        </li>
        <li>
          <b>Conexão com o LinkedIn (quando a pessoa autoriza):</b> o nome e o identificador do perfil que fez o login e o token de
          acesso que o LinkedIn entrega para publicar. O token fica criptografado, vale 60 dias e nunca é exibido nem registrado nos logs.
        </li>
      </ul>
      <p>Não coletamos dados de seguidores, mensagens, comentários, anúncios nem informações pessoais de quem visita as páginas.</p>

      <h2>Para que usamos</h2>
      <p>
        Somente para o que o aplicativo faz: mostrar o calendário de posts, preparar legendas e, quando alguém clica em
        &quot;Publicar agora&quot;, enviar aquele post para a Página do Facebook ou para o Instagram conectado. Nada é publicado sem esse clique.
        Não vendemos dados, não os usamos para publicidade e não os compartilhamos com terceiros além dos serviços citados abaixo.
      </p>

      <h2>Com quem os dados passam</h2>
      <ul>
        <li><b>Meta (Facebook e Instagram):</b> recebe o conteúdo do post e o token, para publicar na conta autorizada.</li>
        <li><b>LinkedIn:</b> recebe o texto e a mídia do post e o token, para publicar no perfil autorizado.</li>
        <li><b>Google Drive:</b> lê os arquivos de mídia e cria as pastas dos posts, com a permissão dada pela empresa.</li>
        <li>
          <b>Anthropic (Claude):</b> se o recurso &quot;Gerar legenda&quot; estiver ligado, o texto do pedido (dados de marca do cliente, ideia do
          post e legenda) é enviado à API para gerar a legenda. Nenhuma mídia é enviada.
        </li>
        <li><b>Render:</b> hospedagem do aplicativo e do banco de dados.</li>
      </ul>

      <h2>Por quanto tempo guardamos</h2>
      <p>
        Os dados ficam enquanto a empresa for cliente do aplicativo. Ao desconectar a conta, o token é apagado na hora. Posts e
        cadastros são apagados quando a empresa pede a exclusão.
      </p>

      <h2>Como excluir seus dados ou remover o acesso</h2>
      <ol>
        <li>
          <b>Remover o acesso do LinkedIn:</b> no LinkedIn, abra Configurações › Privacidade dos dados › Serviços permitidos, escolha este
          aplicativo e remova. No aplicativo, &quot;Desconectar&quot; em Editar cliente apaga o token guardado.
        </li>
        <li>
          <b>Remover o acesso da Meta:</b> no Facebook, abra Configurações › Integrações de negócios (ou Aplicativos e sites), escolha
          este aplicativo e remova. A Meta deixa de aceitar o acesso guardado.
        </li>
        <li>
          <b>Apagar o token no aplicativo:</b> quem administra o aplicativo usa &quot;Desconectar&quot; na edição do cliente, o que apaga o
          acesso do Facebook e do Instagram.
        </li>
        <li>
          <b>Apagar o cadastro e os posts:</b> peça a exclusão ao responsável pelo aplicativo{contato ? <> pelo e-mail <a href={`mailto:${contato}`}>{contato}</a></> : null}. Atendemos em até 30 dias.
        </li>
      </ol>

      <h2>Segurança</h2>
      <p>
        O acesso exige senha, a conexão é protegida por HTTPS e os tokens da Meta e do LinkedIn são guardados criptografados. Ninguém além de quem
        administra o aplicativo tem acesso aos dados.
      </p>

      <h2>Seus direitos (LGPD)</h2>
      <p>
        Você pode pedir acesso, correção, exclusão ou informações sobre o uso dos seus dados pessoais, nos termos da Lei Geral de
        Proteção de Dados (Lei 13.709/2018). O responsável pelo aplicativo é Paulo Eduardo Adoglio Dick{contato ? <>, contato: <a href={`mailto:${contato}`}>{contato}</a></> : null}.
      </p>

      <p className="muted small">Esta política pode mudar; a data no topo mostra a última atualização.</p>
      <p><Link href="/">Voltar para o app</Link></p>
    </main>
  );
}
