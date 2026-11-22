import Link from "next/link";

// Lê a variável de ambiente a cada pedido (sem isso a página sairia pronta da compilação, sem o e-mail).
export const dynamic = "force-dynamic";

export const metadata = { title: "Termos de Serviço · Social Media Manager" };

// Página pública (fora do grupo (app), sem login). É o endereço que o TikTok e a Meta pedem no cadastro do app.
export default function Termos() {
  const contato = process.env.PRIVACY_CONTACT_EMAIL?.trim();
  return (
    <main id="conteudo" tabIndex={-1} className="legal">
      <h1>Termos de Serviço</h1>
      <p className="muted">Social Media Manager (app.ebuks.com.br) · atualizados em 22/11/2026</p>

      <h2>1. O que é o serviço</h2>
      <p>
        O Social Media Manager é uma ferramenta de uso restrito para planejar, escrever e publicar posts em redes sociais de empresas
        clientes. O acesso é feito por senha, por quem administra o aplicativo, em nome das empresas atendidas. Não existe cadastro
        aberto ao público.
      </p>

      <h2>2. Quem pode usar</h2>
      <p>
        Apenas quem recebeu acesso do responsável pelo aplicativo. Quem conecta uma conta de rede social declara que é dono da conta
        ou tem autorização do dono para publicar nela.
      </p>

      <h2>3. Contas conectadas e publicação</h2>
      <ul>
        <li>
          O aplicativo só age nas contas que a pessoa autorizou pelo login da própria rede (Meta, LinkedIn ou TikTok) e só com as
          permissões que a rede mostrou na tela de autorização.
        </li>
        <li>
          Nada é publicado sem uma ação da pessoa: o clique em &quot;Publicar agora&quot; ou em &quot;Confirmar publicação&quot;, que
          autoriza a publicação automática naquele dia e horário. No TikTok, o aplicativo apenas envia o conteúdo como rascunho; a
          publicação é feita pela pessoa, no app do TikTok.
        </li>
        <li>
          A pessoa pode cancelar a confirmação antes do horário e pode desconectar a conta a qualquer momento, no aplicativo ou
          nas configurações da própria rede.
        </li>
      </ul>

      <h2>4. Responsabilidade pelo conteúdo</h2>
      <p>
        O conteúdo publicado (textos, imagens, vídeos, músicas e marcas) é de responsabilidade de quem o preparou e confirmou. Quem
        usa o aplicativo deve ter os direitos sobre o material e respeitar a lei e os termos de cada rede. Legendas geradas com
        ajuda de inteligência artificial são sugestões e devem ser revisadas antes de publicar.
      </p>

      <h2>5. Regras das redes sociais</h2>
      <p>
        O uso de Facebook, Instagram, LinkedIn e TikTok continua sujeito aos termos e às políticas de cada rede. Elas podem limitar,
        recusar ou remover conteúdo e revogar o acesso do aplicativo. O Social Media Manager não controla essas decisões.
      </p>

      <h2>6. Disponibilidade e limites</h2>
      <p>
        Fazemos o possível para manter o serviço no ar, mas ele é oferecido no estado em que está, sem garantia de funcionamento
        ininterrupto. Quedas do aplicativo, das redes sociais, do Google Drive ou da hospedagem podem atrasar ou impedir uma
        publicação; nesses casos o aplicativo avisa e não publica fora da janela de tolerância. Na medida permitida pela lei, não
        respondemos por perdas indiretas causadas por atraso, falha ou recusa de publicação.
      </p>

      <h2>7. Dados pessoais</h2>
      <p>
        O tratamento de dados está descrito na <Link href="/privacidade">Política de Privacidade</Link>, que faz parte destes termos.
      </p>

      <h2>8. Encerramento</h2>
      <p>
        O acesso pode ser encerrado a qualquer momento, por quem administra o aplicativo ou pela empresa cliente. Ao encerrar, os
        tokens guardados são apagados e os dados são excluídos conforme a Política de Privacidade.
      </p>

      <h2>9. Mudanças e contato</h2>
      <p>
        Estes termos podem mudar; a data no topo mostra a última atualização. O responsável pelo aplicativo é Paulo Eduardo Adoglio
        Dick{contato ? <>, contato: <a href={`mailto:${contato}`}>{contato}</a></> : null}. Lei aplicável: a brasileira, com foro na
        comarca de São Paulo (SP).
      </p>

      <p><Link href="/">Voltar para o app</Link></p>
    </main>
  );
}
