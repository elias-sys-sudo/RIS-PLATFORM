# Design System — RIS Platform

## Product Context
- **What this is:** Invoice discounting and early payment platform for Uganda
- **Who it's for:** Suppliers (SMEs), credit officers, finance managers, compliance officers, auditors
- **Space/industry:** Trade finance, invoice factoring, fintech
- **Project type:** Financial dashboard + workflow application

## Aesthetic Direction
- **Direction:** Industrial/Utilitarian with warmth
- **Decoration level:** Intentional (subtle texture on cards, warm neutral backgrounds)
- **Mood:** Trustworthy, professional, approachable. Like a modern bank that actually cares about small businesses. Not sterile, not flashy.
- **Reference sites:** Stripe Dashboard, Mercury, Flutterwave

## Typography
- **Display/Hero:** Plus Jakarta Sans — geometric, professional, distinct from the overused Inter/Poppins. Use for page titles and stat card values.
- **Body:** DM Sans — clean, excellent readability at 14-16px, free via Google Fonts. Use for paragraphs, table cells, form labels.
- **UI/Labels:** DM Sans (same as body, semibold weight for emphasis)
- **Data/Tables:** Geist Mono — tabular-nums variant, perfect for UGX currency columns. Use for all monetary values.
- **Code:** Geist Mono
- **Loading:** Google Fonts CDN for Plus Jakarta Sans and DM Sans. Self-host Geist Mono from Vercel.
- **Scale:**
  - xs: 12px / 0.75rem (captions, helper text)
  - sm: 14px / 0.875rem (table cells, secondary text)
  - base: 16px / 1rem (body text, form inputs)
  - lg: 18px / 1.125rem (section headings)
  - xl: 20px / 1.25rem (card titles)
  - 2xl: 24px / 1.5rem (page titles)
  - 3xl: 30px / 1.875rem (dashboard hero numbers)
  - 4xl: 36px / 2.25rem (marketing headlines)

## Color
- **Approach:** Restrained with one bold accent
- **Primary:** #1B4332 — Deep forest green. Ugandan flag. Symbolizes growth, money, and national identity. Used for sidebar, primary buttons, active states.
- **Accent:** #F59E0B — Warm amber. UGX gold. Used for CTAs, highlights, notifications, progress indicators.
- **Neutrals:** Warm grays (not blue-gray)
  - Background: #FAFAF8
  - Surface: #F5F5F0
  - Border: #E7E5E4
  - Muted text: #78716C
  - Body text: #44403C
  - Heading text: #1C1917
- **Semantic:**
  - Success: #16A34A (green, lighter than primary)
  - Warning: #D97706 (amber, close to accent but distinct)
  - Error: #DC2626 (red)
  - Info: #2563EB (blue)
- **Dark mode:** Invert surfaces (#1C1917 bg, #292524 surface), reduce color saturation 15%, keep primary green as-is, amber accent brightened slightly to #FBBF24.

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable (not cramped like a trading terminal, not spacious like a marketing site)
- **Scale:** 2xs(2px) xs(4px) sm(8px) md(16px) lg(24px) xl(32px) 2xl(48px) 3xl(64px)

## Layout
- **Approach:** Grid-disciplined dashboard
- **Sidebar:** 240px fixed, collapsible to 48px icon-only
- **Grid:** 12 columns at desktop (>1024px), 6 at tablet (768-1024px), 1 at mobile (<768px)
- **Max content width:** 1440px
- **Border radius:**
  - sm: 4px (buttons, inputs, small elements)
  - md: 8px (cards, panels)
  - lg: 12px (modals, popovers)
  - full: 9999px (badges, pills, avatars)

## Motion
- **Approach:** Minimal-functional
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:** micro(50-100ms) short(150-250ms) medium(250-400ms)
- **Rules:**
  - Page transitions: 200ms fade
  - Toast enter/exit: 150ms slide
  - Sidebar collapse: 200ms
  - Table row hover: instant (no delay)
  - No scroll-triggered animations
  - No decorative motion

## Component Guidelines
- **Buttons:** Primary = #1B4332 bg + white text. Secondary = outline with #1B4332 border. Destructive = #DC2626. Ghost = transparent. All have 4px radius.
- **Cards:** #FFFFFF bg (light) / #292524 (dark), 8px radius, 1px #E7E5E4 border, 16px padding.
- **Tables:** Alternating row backgrounds (#FAFAF8 / #FFFFFF). Hover = #F5F5F0. Sticky header. Geist Mono for monetary columns.
- **Status badges:** 9999px radius pills. Color-coded per invoice status. Uppercase text at 11px.
- **Forms:** 4px radius inputs, 16px padding, focus ring = #1B4332 with 2px offset.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-09 | Initial design system | Created by /design-consultation. Green + amber palette chosen over standard blue to give RIS a distinctly Ugandan identity while maintaining fintech trust signals. Plus Jakarta Sans + DM Sans chosen over Inter for freshness without sacrificing readability. |
