'use client'

import Link from 'next/link'

import { IconBrandGithub as SiGithub } from '@tabler/icons-react'

import { DropdownMenuItem } from '@/components/ui/dropdown-menu'

const externalLinks = [
  {
    name: 'GitHub',
    href: 'https://github.com/optixai32-hue/Nelth_Optix-AI-',
    icon: <SiGithub className="size-4" />
  }
]

export function ExternalLinkItems() {
  return (
    <>
      {externalLinks.map(link => (
        <DropdownMenuItem key={link.name} asChild>
          <Link href={link.href} target="_blank" rel="noopener noreferrer">
            {link.icon}
            <span>{link.name}</span>
          </Link>
        </DropdownMenuItem>
      ))}
    </>
  )
}
