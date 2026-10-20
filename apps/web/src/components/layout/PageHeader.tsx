interface PageHeaderProps {
  title: string;
  children?: React.ReactNode;
}

/** The sidebar already names the page, so the title is for assistive tech and the controls row is the header. */
export function PageHeader({ title, children }: PageHeaderProps) {
  return (
    <header className={children ? 'border-b' : undefined}>
      <h1 className="sr-only">{title}</h1>
      {children}
    </header>
  );
}
