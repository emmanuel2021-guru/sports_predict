interface Props {
  title: string;
  subtitle?: string;
  gradient: string;
  children?: React.ReactNode;
}

export function ProHeader({ title, subtitle, gradient, children }: Props) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl px-8 py-7 mb-7 shadow-2xl animate-fade-in"
      style={{ background: gradient }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 80% 20%, rgba(255,255,255,0.15) 0%, transparent 50%)',
        }}
      />
      <div className="relative flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-white/85 font-medium">{subtitle}</div>}
        </div>
        {children && <div className="flex items-center gap-3">{children}</div>}
      </div>
    </div>
  );
}
