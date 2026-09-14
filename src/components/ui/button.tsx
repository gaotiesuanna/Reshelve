import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-index text-body font-medium leading-body transition-colors outline-none focus-visible:ring-2 focus-visible:ring-index-blue disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none [&>svg]:pointer-events-none [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-index-ink text-index-canvas hover:bg-zinc-800',
        destructive: 'bg-red-700 text-white hover:bg-red-800',
        outline: 'border border-index-line bg-index-canvas text-index-ink hover:bg-index-blue-soft',
        secondary: 'bg-index-blue-soft text-index-ink hover:bg-index-blue-soft/70',
        ghost: 'text-index-muted hover:bg-index-blue-soft hover:text-index-ink',
        link: 'text-index-blue underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-6',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
