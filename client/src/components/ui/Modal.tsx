import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  titleIcon?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  titleIcon,
  children,
  className,
}: ModalProps): JSX.Element {
  const descriptionId = useId();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay fixed inset-0 z-40 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          aria-describedby={description ? descriptionId : undefined}
          className={cn(
            'modal-panel fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl bg-card p-5 shadow-soft',
            className,
          )}
        >
          <div className="modal-header flex items-start justify-between gap-3">
            {titleIcon ? (
              <span className="modal-title-icon" aria-hidden="true">
                {titleIcon}
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-lg font-display font-semibold text-foreground">
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description
                  id={descriptionId}
                  className="mt-1 text-sm text-muted-foreground"
                >
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close
              className="modal-close rounded-full p-1 text-foreground/60 hover:bg-muted"
              aria-label="Đóng"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <div className="modal-body mt-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
