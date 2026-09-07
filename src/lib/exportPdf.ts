import jsPDF from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import type { PackingResult } from './packing'
import type { DeckConfig, Unit } from '@/store/calculator'
import { UNIT_LABEL } from '@/store/calculator'
import { fmtNumber } from './utils'

// App palette (mirrors the colors already used on-screen: slate-900 ink,
// sky-500 accent, slate-100/200 for card backgrounds/borders).
const INK: [number, number, number] = [15, 23, 42]
const CARD_BG: [number, number, number] = [241, 245, 249]
const BORDER: [number, number, number] = [226, 232, 240]
const MUTED: [number, number, number] = [100, 116, 139]
const GOOD: [number, number, number] = [5, 150, 105]
const WARN: [number, number, number] = [217, 119, 6]
const DANGER: [number, number, number] = [220, 38, 38]

const FONT_FAMILY = 'PTSans'

// jsPDF's built-in fonts (helvetica/times/courier) only cover WinAnsi/Latin
// glyphs — any Cyrillic text renders as garbage. PT Sans is a Cyrillic-native
// open-source font (SIL OFL, see public/fonts/PTSans-OFL.txt) embedded as a
// real TTF so Russian labels/table content render correctly. The font bytes
// are fetched lazily (only when a PDF is actually requested) and cached —
// but registration itself (addFileToVFS/addFont) is per-jsPDF-instance, so
// it must be redone for every new document, just from the cached bytes.
let fontBytesPromise: Promise<{ regular: string; bold: string }> | null = null

async function fetchAsBase64(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Не удалось загрузить шрифт: ${url}`)
  const buf = await res.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

async function registerFonts(pdf: jsPDF): Promise<void> {
  if (!fontBytesPromise) {
    fontBytesPromise = Promise.all([
      fetchAsBase64('/fonts/PTSans-Regular.ttf'),
      fetchAsBase64('/fonts/PTSans-Bold.ttf'),
    ]).then(([regular, bold]) => ({ regular, bold }))
  }
  const { regular, bold } = await fontBytesPromise
  pdf.addFileToVFS('PTSans-Regular.ttf', regular)
  pdf.addFont('PTSans-Regular.ttf', FONT_FAMILY, 'normal')
  pdf.addFileToVFS('PTSans-Bold.ttf', bold)
  pdf.addFont('PTSans-Bold.ttf', FONT_FAMILY, 'bold')
}

// Serializes the already-mounted deck SVG (all fills/strokes are inline hex
// attributes, not Tailwind classes, so it's self-contained) and rasterizes it
// to a JPEG data URL via an offscreen canvas — no separate "print mode"
// rendering path needed, we just capture what's already on screen. JPEG
// (rather than PNG) keeps the embedded image from ballooning the file size.
async function rasterizeSvg(svgEl: SVGSVGElement, scale = 2): Promise<{ dataUrl: string; width: number; height: number }> {
  const clone = svgEl.cloneNode(true) as SVGSVGElement
  const viewBox = svgEl.viewBox.baseVal
  const width = (viewBox && viewBox.width) || svgEl.clientWidth || 900
  const height = (viewBox && viewBox.height) || svgEl.clientHeight || 560
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))

  const svgString = new XMLSerializer().serializeToString(clone)
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Не удалось растрировать схему палубы'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = height * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D недоступен в этом браузере')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.92), width: canvas.width, height: canvas.height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-zа-яё0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  )
}

// One row per placement that carries a computed РД 31.11.21.23-96 п. 2.2.3
// lashing requirement (n = 0,3·P/BL) — built by the caller from manual +
// pinned placements, since exportPdf itself has no store access.
export interface LashingRequirementRow {
  name: string
  requiredCount: number
  attachedCount: number
  wireLabel: string
  justification?: string
  category?: string
}

// РД 31.11.21.23-96 only actually covers metal products — see
// lashingMethodologyFor in packing.ts for the same list used in the UI.
const DANGEROUS_GOODS_CATEGORIES = new Set(['Опасный груз', 'Химикаты', 'Взрывоопасный'])

interface ExportDeckPlanToPdfOptions {
  svgEl: SVGSVGElement
  deck: DeckConfig
  unit: Unit
  result: PackingResult
  projectName: string
  lashingRequirements?: LashingRequirementRow[]
}

export async function exportDeckPlanToPdf({
  svgEl,
  deck,
  unit,
  result,
  projectName,
  lashingRequirements,
}: ExportDeckPlanToPdfOptions): Promise<void> {
  const { dataUrl: img, width: imgWidthPx, height: imgHeightPx } = await rasterizeSvg(svgEl)
  const unitLabel = UNIT_LABEL[unit]
  const utilPct = Math.round(result.utilization * 100)
  const utilColor = utilPct >= 85 ? GOOD : utilPct >= 60 ? WARN : MUTED

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  await registerFonts(pdf)
  const pageWidth = pdf.internal.pageSize.getWidth()
  const margin = 32
  const contentWidth = pageWidth - margin * 2

  // --- Header band ---
  const headerHeight = 56
  pdf.setFillColor(...INK)
  pdf.rect(0, 0, pageWidth, headerHeight, 'F')
  pdf.setTextColor(255, 255, 255)
  pdf.setFont(FONT_FAMILY, 'bold')
  pdf.setFontSize(16)
  pdf.text('DeckLoad', margin, 24)
  pdf.setFont(FONT_FAMILY, 'normal')
  pdf.setFontSize(11)
  pdf.text(projectName, margin, 42)
  const date = new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())
  pdf.setFontSize(9)
  pdf.setTextColor(203, 213, 225)
  pdf.text(date, pageWidth - margin, 24, { align: 'right' })
  pdf.text(`Палуба ${fmtNumber(deck.width)}×${fmtNumber(deck.length)} ${unitLabel}`, pageWidth - margin, 38, { align: 'right' })

  let y = headerHeight + 22

  // --- Stat cards ---
  const cards: { label: string; value: string; color: [number, number, number] }[] = [
    { label: 'ЗАГРУЗКА ПАЛУБЫ', value: `${utilPct}%`, color: utilColor },
    { label: 'РАЗМЕЩЕНО', value: `${result.placedCount}/${result.requestedCount} ед.`, color: INK },
    { label: 'ОБЩИЙ ВЕС', value: `${fmtNumber(result.totalWeight)} кг`, color: INK },
    { label: 'РАЗМЕР ПАЛУБЫ', value: `${fmtNumber(deck.width)}×${fmtNumber(deck.length)} ${unitLabel}`, color: INK },
  ]
  const cardGap = 12
  const cardWidth = (contentWidth - cardGap * (cards.length - 1)) / cards.length
  const cardHeight = 46
  cards.forEach((card, i) => {
    const x = margin + i * (cardWidth + cardGap)
    pdf.setFillColor(...CARD_BG)
    pdf.setDrawColor(...BORDER)
    pdf.roundedRect(x, y, cardWidth, cardHeight, 4, 4, 'FD')
    pdf.setFont(FONT_FAMILY, 'normal')
    pdf.setFontSize(7.5)
    pdf.setTextColor(...MUTED)
    pdf.text(card.label, x + 10, y + 16)
    pdf.setFont(FONT_FAMILY, 'bold')
    pdf.setFontSize(15)
    pdf.setTextColor(...card.color)
    pdf.text(card.value, x + 10, y + 34)
  })
  y += cardHeight + 20

  // --- Deck layout image ---
  pdf.setFont(FONT_FAMILY, 'bold')
  pdf.setFontSize(10)
  pdf.setTextColor(...INK)
  pdf.text('Схема палубы', margin, y)
  y += 10

  const maxImgWidth = contentWidth
  const maxImgHeight = 260
  const imgScale = Math.min(maxImgWidth / imgWidthPx, maxImgHeight / imgHeightPx)
  const imgWidth = imgWidthPx * imgScale
  const imgHeight = imgHeightPx * imgScale
  const imgX = margin + (contentWidth - imgWidth) / 2
  pdf.setDrawColor(...BORDER)
  pdf.setFillColor(255, 255, 255)
  pdf.roundedRect(imgX - 4, y - 4, imgWidth + 8, imgHeight + 8, 3, 3, 'FD')
  pdf.addImage(img, 'JPEG', imgX, y, imgWidth, imgHeight)
  y += imgHeight + 26

  // --- Breakdown table ---
  pdf.setFont(FONT_FAMILY, 'bold')
  pdf.setFontSize(10)
  pdf.setTextColor(...INK)
  pdf.text('Учёт по грузам', margin, y)
  y += 8

  autoTable(pdf, {
    startY: y,
    margin: { left: margin, right: margin, bottom: 36 },
    head: [['Груз', 'Ярусы', 'Размещено', 'Всего ед.', 'Площадь', 'Вес']],
    body: result.breakdown.map((b) => [
      b.name,
      b.layers > 1 ? `×${b.layers}` : '1',
      String(b.footprints),
      `${b.placed}/${b.requested}`,
      fmtNumber(b.area),
      b.weight > 0 ? fmtNumber(b.weight) : '—',
    ]),
    theme: 'grid',
    styles: {
      font: FONT_FAMILY,
      fontSize: 9,
      cellPadding: 6,
      lineColor: BORDER,
      lineWidth: 0.5,
      textColor: INK,
    },
    headStyles: {
      font: FONT_FAMILY,
      fillColor: INK,
      textColor: 255,
      fontStyle: 'bold',
      halign: 'left',
    },
    alternateRowStyles: { fillColor: CARD_BG },
    columnStyles: {
      0: { halign: 'left' },
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right', fontStyle: 'bold' },
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
  })

  // --- Lashing count table, only when at least one placement actually
  // carries a computed requirement. Title stays neutral because the
  // РД 31.11.21.23-96 figure is only literally correct for metal-products
  // cargo — see the footnote below and lashingMethodologyFor in packing.ts. ---
  if (lashingRequirements && lashingRequirements.length > 0) {
    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 22
    pdf.setFont(FONT_FAMILY, 'bold')
    pdf.setFontSize(10)
    pdf.setTextColor(...INK)
    pdf.text('Крепление груза (расчётная оценка)', margin, y)
    y += 8

    autoTable(pdf, {
      startY: y,
      margin: { left: margin, right: margin, bottom: 36 },
      head: [['Груз', 'Категория', 'Канат', 'Требуется', 'Прикреплено', 'Обоснование']],
      body: lashingRequirements.map((r) => [
        r.name,
        r.category || '—',
        r.wireLabel,
        String(r.requiredCount),
        String(r.attachedCount),
        r.attachedCount < r.requiredCount ? (r.justification || '—') : '—',
      ]),
      theme: 'grid',
      styles: {
        font: FONT_FAMILY,
        fontSize: 9,
        cellPadding: 6,
        lineColor: BORDER,
        lineWidth: 0.5,
        textColor: INK,
      },
      headStyles: {
        font: FONT_FAMILY,
        fillColor: INK,
        textColor: 255,
        fontStyle: 'bold',
        halign: 'left',
      },
      alternateRowStyles: { fillColor: CARD_BG },
      columnStyles: {
        0: { halign: 'left' },
        1: { halign: 'left' },
        2: { halign: 'left' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'left' },
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 4) {
          const row = lashingRequirements[data.row.index]
          if (row && row.attachedCount < row.requiredCount) data.cell.styles.textColor = WARN
        }
      },
    })

    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14
    pdf.setFont(FONT_FAMILY, 'normal')
    pdf.setFontSize(7.5)
    pdf.setTextColor(...MUTED)
    pdf.text('* Формула РД 31.11.21.23-96 применена буквально только к категории «Металлопродукция»; для остального груза — ориентировочно.', margin, y)

    const hasDangerousGoods = lashingRequirements.some((r) => r.category && DANGEROUS_GOODS_CATEGORIES.has(r.category))
    if (hasDangerousGoods) {
      y += 11
      pdf.setFont(FONT_FAMILY, 'bold')
      pdf.setTextColor(...DANGER)
      pdf.text(
        '⚠ Груз категории «Опасный груз/Химикаты/Взрывоопасный» требует отдельного расчёта по IMDG Code (сегрегация, размещение, классификация) — не входит в этот отчёт.',
        margin,
        y
      )
    }
  }

  // --- Footer on every page ---
  const pageCount = pdf.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i)
    const pageHeight = pdf.internal.pageSize.getHeight()
    pdf.setDrawColor(...BORDER)
    pdf.line(margin, pageHeight - 24, pageWidth - margin, pageHeight - 24)
    pdf.setFont(FONT_FAMILY, 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(...MUTED)
    pdf.text('DeckLoad', margin, pageHeight - 12)
    pdf.text(`Стр. ${i} из ${pageCount}`, pageWidth - margin, pageHeight - 12, { align: 'right' })
  }

  const fileDate = new Date().toISOString().slice(0, 10)
  pdf.save(`deckload-${slugify(projectName)}-${fileDate}.pdf`)
}
