'use client'

import { useMemo, useState } from 'react'
import { Ship, RotateCw, Github, Anchor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { useCalculator } from '@/store/calculator'
import { packDeck } from '@/lib/packing'
import { DeckVisualization } from '@/components/calculator/DeckVisualization'
import { DeckConfigPanel } from '@/components/calculator/DeckConfigPanel'
import { ItemList } from '@/components/calculator/ItemList'
import { StatsPanel } from '@/components/calculator/StatsPanel'

export default function Home() {
  const deck = useCalculator((s) => s.deck)
  const items = useCalculator((s) => s.items)
  const sortStrategy = useCalculator((s) => s.sortStrategy)
  const globalRotation = useCalculator((s) => s.globalRotation)
  const toggleGlobalRotation = useCalculator((s) => s.toggleGlobalRotation)
  const showFreeSpace = useCalculator((s) => s.showFreeSpace)
  const showGrid = useCalculator((s) => s.showGrid)
  const showLabels = useCalculator((s) => s.showLabels)

  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null)

  const result = useMemo(() => {
    const effectiveItems = globalRotation
      ? items
      : items.map((it) => ({ ...it, allowRotation: false }))
    return packDeck(deck.width, deck.length, effectiveItems, sortStrategy)
  }, [deck.width, deck.length, items, sortStrategy, globalRotation])

  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto max-w-[1600px] px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Ship className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <h1 className="text-base font-bold tracking-tight">
                DeckLoad — Калькулятор загрузки палубы
              </h1>
              <p className="text-xs text-muted-foreground hidden sm:block">
                Расчёт размещения грузов, свободного пространства и коэффициента
                загрузки с поддержкой вращения
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <Badge variant="outline" className="hidden md:inline-flex">
              <Anchor className="h-3 w-3 mr-1" />
              {deck.width}×{deck.length} {deck.unit}
            </Badge>
            <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5">
              <RotateCw
                className={`h-4 w-4 transition-colors ${globalRotation ? 'text-primary' : 'text-muted-foreground'}`}
              />
              <span className="text-sm font-medium hidden sm:inline">
                Вращение
              </span>
              <Switch
                checked={globalRotation}
                onCheckedChange={toggleGlobalRotation}
                aria-label="Переключить вращение"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 mx-auto w-full max-w-[1600px] px-4 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: config */}
          <div className="lg:col-span-3 space-y-4">
            <DeckConfigPanel />
            <StatsPanel result={result} unit={deck.unit} />
          </div>

          {/* Center: visualization */}
          <div className="lg:col-span-6">
            <Card className="h-full">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <CardTitle className="text-base">Схема палубы</CardTitle>
                    <CardDescription>
                      Вид сверху. Зелёная штриховка — свободное пространство
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <LegendDot color="#0ea5e9" label="Груз" />
                    <LegendDot hatch label="Свободно" />
                    <LegendDot icon="↻" label="Повернут" />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <DeckVisualization
                  result={result}
                  unit={deck.unit}
                  showFreeSpace={showFreeSpace}
                  showGrid={showGrid}
                  showLabels={showLabels}
                  hoveredItemId={hoveredItemId}
                  onHover={setHoveredItemId}
                />
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Размещено {result.placed.length} из{' '}
                    {result.placed.length + result.unplaced.length} ед.
                  </span>
                  <span>
                    Загрузка:{' '}
                    <span className="font-semibold text-foreground">
                      {Math.round(result.utilization * 100)}%
                    </span>
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: items */}
          <div className="lg:col-span-3">
            <ItemList
              result={result}
              unit={deck.unit}
              hoveredItemId={hoveredItemId}
              onHover={setHoveredItemId}
            />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto max-w-[1600px] px-4 py-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            DeckLoad Calculator · Алгоритм Maximal Rectangles (BSSF) · 2D-упаковка с
            вращением
          </span>
          <Button variant="ghost" size="sm" asChild className="h-7">
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className="text-xs"
            >
              <Github className="h-3.5 w-3.5 mr-1" />
              Исходники
            </a>
          </Button>
        </div>
      </footer>
    </div>
  )
}

function LegendDot({
  color,
  label,
  hatch,
  icon,
}: {
  color?: string
  label: string
  hatch?: boolean
  icon?: string
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {hatch ? (
        <span
          className="h-3 w-3 rounded-sm border border-emerald-500/50"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, rgba(16,185,129,0.35) 0 2px, transparent 2px 5px)',
          }}
        />
      ) : icon ? (
        <span className="grid h-3 w-3 place-items-center text-[10px] font-bold text-primary">
          {icon}
        </span>
      ) : (
        <span
          className="h-3 w-3 rounded-sm border border-black/10"
          style={{ backgroundColor: color }}
        />
      )}
      {label}
    </span>
  )
}
