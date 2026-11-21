/** Logotipo quadrado do app (public/logo.svg). Decorativo: o nome do app vem escrito ao lado. */
export default function BrandLogo({ size = 36 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo.svg" width={size} height={size} alt="" className="brand-logo" />;
}
