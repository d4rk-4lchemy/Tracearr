import { AlertCircle } from 'lucide-react';

export function AuthFormError({ id, message }: { id?: string; message: string | null }) {
  if (!message) return null;

  return (
    <p id={id} className="text-destructive flex items-center gap-1.5 text-sm" role="alert">
      <AlertCircle className="h-4 w-4 shrink-0" />
      {message}
    </p>
  );
}
