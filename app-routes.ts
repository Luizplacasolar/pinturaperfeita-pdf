// ============================================================
// PINTURA PERFEITA — Páginas de Auth + API Routes completas
// ============================================================

// ─── app/auth/register/page.tsx ──────────────────────────────
/*
'use client'
import { useState } from 'react'
import { useAuth } from '@/lib/supabase-provider'
import { useRouter } from 'next/navigation'

export default function RegisterPage() {
  const { signUp } = useAuth()
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    email: '', password: '', confirmPassword: '',
    fullName: '', companyName: '', phone: '',
    plan: 'free',
  })

  const F = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  const handleRegister = async () => {
    if (form.password !== form.confirmPassword) { setError('Senhas não conferem'); return }
    if (form.password.length < 8) { setError('Senha deve ter ao menos 8 caracteres'); return }
    setLoading(true); setError('')
    try {
      await signUp(form.email, form.password, form.fullName, form.companyName)
      router.push('/dashboard?welcome=1')
    } catch (e: any) {
      setError(e.message ?? 'Erro ao criar conta')
    } finally { setLoading(false) }
  }

  // ... JSX da tela de cadastro
}
*/

// ─── app/api/whatsapp/send/route.ts ──────────────────────────
export const WHATSAPP_ROUTE = `
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const { data: profile } = await supabase
      .from('users')
      .select('company_id, company:companies(evolution_api_url, evolution_api_token, whatsapp_enabled, name)')
      .eq('id', user.id)
      .single()

    const company = (profile?.company as any)
    if (!company?.whatsapp_enabled || !company?.evolution_api_url) {
      return NextResponse.json({ error: 'WhatsApp não configurado. Acesse Configurações → Integrações.' }, { status: 400 })
    }

    const body = await request.json()
    const { phone, message, estimateId, type = 'text' } = body

    if (!phone || !message) {
      return NextResponse.json({ error: 'phone e message são obrigatórios' }, { status: 400 })
    }

    // Formatar número (remover formatação)
    const cleanPhone = phone.replace(/\\D/g, '')
    const numberWithCountry = cleanPhone.startsWith('55') ? cleanPhone : '55' + cleanPhone

    // Chamar Evolution API
    const evolutionRes = await fetch(
      \`\${company.evolution_api_url}/message/sendText/\${company.name?.replace(/\\s+/g,'-').toLowerCase() ?? 'pinturaperfeita'}\`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: company.evolution_api_token },
        body: JSON.stringify({ number: numberWithCountry, textMessage: { text: message } }),
        signal: AbortSignal.timeout(15_000),
      }
    )

    const evolutionData = await evolutionRes.json().catch(() => ({}))

    // Registrar log
    await supabase.from('whatsapp_logs').insert({
      company_id: profile!.company_id,
      estimate_id: estimateId ?? null,
      phone: numberWithCountry,
      message_type: type,
      message,
      status: evolutionRes.ok ? 'enviado' : 'erro',
      error: evolutionRes.ok ? null : JSON.stringify(evolutionData),
    })

    if (!evolutionRes.ok) {
      return NextResponse.json({ error: 'Falha ao enviar via Evolution API', detail: evolutionData }, { status: 502 })
    }

    return NextResponse.json({ success: true, messageId: evolutionData.key?.id })
  } catch (err: any) {
    console.error('[API/whatsapp/send]', err)
    return NextResponse.json({ error: err.message ?? 'Erro interno' }, { status: 500 })
  }
}
`

// ─── app/api/ai/analyze/route.ts ─────────────────────────────
export const AI_ROUTE = `
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const body = await request.json()
  const { type, data } = body

  const prompts: Record<string, string> = {
    estimate_analysis: \`Você é especialista em pintura predial no Brasil com 20 anos de experiência.
Analise este orçamento e responda APENAS com JSON válido (sem markdown):
Dados: tipo=\${data.propertyType}, área=\${data.totalArea}m², tinta=\${data.paintType}, total=R$\${data.total}, margem=\${data.profitMargin}%
{
  "priceAnalysis": "análise do preço vs mercado (1 frase)",
  "marginFeedback": "feedback sobre margem (1 frase)",
  "technicalTip": "dica técnica (1 frase)",
  "riskLevel": "baixo|médio|alto",
  "suggestedMargin": número,
  "isCompetitive": true|false,
  "recommendedAction": "texto de ação recomendada"
}\`,
    generate_description: \`Crie descrição profissional para proposta de pintura:
Imóvel: \${data.propertyType} de \${data.totalArea}m²
Serviços: \${data.services?.join(', ')}
Tinta: \${data.paintType}
Escreva 2 parágrafos curtos, profissional, transmitindo qualidade e confiança. Em português brasileiro.\`,
    chat: \`Você é assistente especializado do sistema Pintura Perfeita Pro.
Responda em português brasileiro de forma concisa e prática.
Foque em: preços, cálculos de materiais, gestão de obras e pintores.
Pergunta: \${data.message}\`,
  }

  const prompt = prompts[type]
  if (!prompt) return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 })

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''

  if (type === 'estimate_analysis') {
    try {
      const parsed = JSON.parse(text.replace(/\`\`\`json|"\`\`\`/g, '').trim())
      return NextResponse.json({ success: true, data: parsed })
    } catch {
      return NextResponse.json({ success: true, data: { priceAnalysis: text } })
    }
  }

  return NextResponse.json({ success: true, text })
}
`

// ─── app/api/team/invite/route.ts ────────────────────────────
export const TEAM_INVITE_ROUTE = `
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const { data: requestingUser } = await supabase
      .from('users')
      .select('role, company_id')
      .eq('id', user.id)
      .single()

    if (requestingUser?.role !== 'admin') {
      return NextResponse.json({ error: 'Apenas admins podem convidar membros' }, { status: 403 })
    }

    const { email, fullName, role } = await request.json()

    if (!email || !fullName || !role) {
      return NextResponse.json({ error: 'email, fullName e role são obrigatórios' }, { status: 400 })
    }

    const adminSupabase = createAdminClient()

    // Criar usuário no Auth (sem senha — receberá email para definir)
    const { data: newUser, error: authError } = await adminSupabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })

    if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })

    // Criar perfil
    const { error: profileError } = await adminSupabase.from('users').insert({
      id: newUser.user.id,
      company_id: requestingUser.company_id,
      full_name: fullName,
      email,
      role,
    })

    if (profileError) {
      await adminSupabase.auth.admin.deleteUser(newUser.user.id)
      return NextResponse.json({ error: profileError.message }, { status: 500 })
    }

    // Gerar link de convite
    await adminSupabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: \`\${process.env.NEXT_PUBLIC_APP_URL}/auth/accept-invite\` },
    })

    return NextResponse.json({ success: true, message: \`Convite enviado para \${email}\` })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
`

// ─── next.config.ts ──────────────────────────────────────────
export const NEXT_CONFIG = `
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: [],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
  // Redirecionar raiz para dashboard
  async redirects() {
    return [
      { source: '/', destination: '/dashboard', permanent: false },
    ]
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]
  },
}

export default nextConfig
`

// ─── tailwind.config.ts ───────────────────────────────────────
export const TAILWIND_CONFIG = `
import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        gold: { DEFAULT: '#C9A84C', light: '#E3C26A', dim: '#7A6020' },
        surface: '#17171A',
        'surface-high': '#1E1E23',
      },
      fontFamily: {
        serif: ['Cormorant Garamond', 'serif'],
        sans: ['DM Sans', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
      },
    },
  },
  plugins: [],
  darkMode: 'class',
}

export default config
`

// ─── src/lib/supabase.ts (server) ────────────────────────────
export const SUPABASE_SERVER = `
import { createClient } from '@supabase/supabase-js'

/** Cliente com service role — usar APENAS em server-side */
export function createServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

/** Cliente admin (service role key) — NUNCA expor no browser */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY não definida')
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
}
`

// ─── Estrutura completa de pastas ─────────────────────────────
export const FOLDER_STRUCTURE = `
pinturaperfeita/
├── src/
│   ├── app/
│   │   ├── layout.tsx                    ← AuthProvider wrapper
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   ├── register/page.tsx         ← Cadastro com onboarding
│   │   │   └── forgot-password/page.tsx
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx                ← Sidebar + Topbar
│   │   │   ├── dashboard/page.tsx        ← useDashboard()
│   │   │   ├── estimates/
│   │   │   │   ├── page.tsx              ← useEstimates()
│   │   │   │   └── new/page.tsx          ← EstimateBuilder
│   │   │   ├── clients/page.tsx          ← useClients()
│   │   │   ├── financial/page.tsx        ← useFinancial()
│   │   │   ├── workers/page.tsx          ← useWorkers()
│   │   │   ├── materials/page.tsx        ← useMaterials()
│   │   │   ├── schedule/page.tsx         ← useSchedule()
│   │   │   ├── whatsapp/page.tsx         ← useWhatsApp()
│   │   │   ├── reports/page.tsx
│   │   │   ├── notifications/page.tsx    ← useNotifications()
│   │   │   ├── team/page.tsx             ← useTeam()
│   │   │   ├── ai/page.tsx               ← Chat IA
│   │   │   └── settings/page.tsx         ← updateCompany()
│   │   ├── api/
│   │   │   ├── pdf/
│   │   │   │   ├── [id]/route.ts         ← GET proposta
│   │   │   │   ├── ordem-servico/[id]/route.ts
│   │   │   │   ├── recibo/route.ts       ← POST recibo
│   │   │   │   ├── relatorio/materiais/route.ts
│   │   │   │   ├── batch/route.ts        ← POST ZIP
│   │   │   │   └── health/route.ts
│   │   │   ├── ai/
│   │   │   │   ├── analyze/route.ts      ← Claude (chave segura)
│   │   │   │   └── chat/route.ts
│   │   │   ├── whatsapp/
│   │   │   │   └── send/route.ts         ← Evolution API
│   │   │   └── team/
│   │   │       └── invite/route.ts       ← Admin invite
│   │   └── p/[code]/page.tsx             ← Aprovação pública do cliente
│   ├── lib/
│   │   ├── supabase-provider.tsx         ← AuthProvider + todos os hooks
│   │   ├── supabase.ts                   ← createServerClient, createAdminClient
│   │   └── pdf-client.ts                 ← PdfServiceClient
│   ├── components/
│   │   ├── ui/                           ← Button, Card, Input, Badge, Modal...
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   └── Topbar.tsx
│   │   ├── estimates/
│   │   │   ├── EstimateWizard.tsx
│   │   │   ├── EstimateList.tsx
│   │   │   └── EstimateDetail.tsx
│   │   ├── pdf/
│   │   │   ├── PdfDropdownButton.tsx     ← Botão com dropdown de templates
│   │   │   ├── PdfPreviewModal.tsx       ← Modal de preview
│   │   │   └── BatchDownloadButton.tsx
│   │   └── clients/
│   │       ├── ClientList.tsx
│   │       └── ClientForm.tsx
│   ├── hooks/
│   │   └── usePdf.ts                     ← Hook de download
│   ├── types/
│   │   └── database.ts                   ← Todos os tipos TypeScript
│   └── middleware.ts                     ← Proteção de rotas
├── python/                               ← Microserviço PDF
│   ├── pdf_templates.py                  ← 4 templates
│   ├── pdf_service_complete.py           ← FastAPI server
│   └── requirements.txt
├── supabase/
│   └── migrations/
│       ├── 001_schema.sql
│       ├── 002_rls_policies.sql
│       └── 003_views_functions_seed.sql
├── .env.example
├── next.config.ts
├── tailwind.config.ts
└── package.json
`
