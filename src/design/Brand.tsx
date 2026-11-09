export function VexoraBrand({ subtitle = 'CLIENT PORTAL' }: { subtitle?: string }) {
  return (
    <>
      <img className="brand-logo" src="/brand/vexora-logo.png" alt="" width="54" height="36" />
      <span className="brand-wordmark">
        VEXORA<small>{subtitle}</small>
      </span>
    </>
  );
}
