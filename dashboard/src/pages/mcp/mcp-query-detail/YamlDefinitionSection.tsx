import { useState, useRef, useCallback } from 'react';
import { Maximize2, Minimize2, Copy, Check, BookOpen } from 'lucide-react';
import { FullscreenOverlay } from '../../../components/common/layout/FullscreenOverlay';

const ICON = 'w-3 h-3';
const BTN = 'p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-raised/60 transition-colors duration-150';
const BTN_LG = 'p-2 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-raised transition-colors duration-150';

interface YamlDefinitionSectionProps {
  yamlText: string;
  configEditing: boolean;
  yamlDraft: string;
  setYamlDraft: (v: string) => void;
  yamlTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function YamlDefinitionSection({
  yamlText,
  configEditing,
  yamlDraft,
  setYamlDraft,
  yamlTextareaRef,
}: YamlDefinitionSectionProps) {
  const [yamlFullscreen, setYamlFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const yamlSectionRef = useRef<HTMLDivElement>(null);

  const handleCopyYaml = useCallback(() => {
    navigator.clipboard.writeText(yamlText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [yamlText]);

  return (
    <div>
      <h4 className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">YAML Definition</h4>
      <div ref={yamlSectionRef} className="relative">
        {/* Toolbar — inside the widget, upper right */}
        <div className="absolute top-2 right-2 z-10 flex items-center gap-0.5 bg-surface-sunken/90 rounded backdrop-blur-sm">
          <a
            href="https://github.com/hotmeshio/sdk-typescript/blob/main/docs/quickstart.md"
            target="_blank"
            rel="noopener noreferrer"
            className={BTN}
            title="YAML Guide"
          >
            <BookOpen className={ICON} />
          </a>
          <button onClick={handleCopyYaml} className={BTN} title="Copy YAML">
            {copied ? <Check className={`${ICON} text-status-success`} /> : <Copy className={ICON} />}
          </button>
          <button onClick={() => setYamlFullscreen(true)} className={BTN} title="Fullscreen">
            <Maximize2 className={ICON} />
          </button>
        </div>

        {configEditing ? (
          <textarea
            ref={yamlTextareaRef}
            value={yamlDraft}
            onChange={(e) => setYamlDraft(e.target.value)}
            className="w-full p-4 pr-28 bg-surface-sunken rounded-md text-xs font-mono text-text-primary leading-relaxed border border-surface-border focus:border-accent focus:outline-none resize-none overflow-hidden"
            rows={yamlDraft.split('\n').length + 1}
            style={{ fieldSizing: 'content' } as React.CSSProperties}
            spellCheck={false}
          />
        ) : (
          <pre className="p-4 pr-28 bg-surface-sunken rounded-md text-xs font-mono text-text-secondary overflow-x-auto whitespace-pre">
            {yamlText}
          </pre>
        )}
      </div>

      {/* YAML Fullscreen overlay — supports both view and edit modes */}
      <FullscreenOverlay open={yamlFullscreen} onClose={() => setYamlFullscreen(false)} sourceRef={yamlSectionRef}>
        <div className="sticky top-0 float-right z-10">
          <div className="flex items-center gap-0.5 bg-surface-sunken/80 rounded-md backdrop-blur-sm">
            <a
              href="https://github.com/hotmeshio/sdk-typescript/blob/main/docs/quickstart.md"
              target="_blank"
              rel="noopener noreferrer"
              className={BTN_LG}
              title="YAML Guide"
            >
              <BookOpen className="w-5 h-5" />
            </a>
            <button onClick={handleCopyYaml} className={BTN_LG} title="Copy YAML">
              {copied ? <Check className="w-5 h-5 text-status-success" /> : <Copy className="w-5 h-5" />}
            </button>
            <button onClick={() => setYamlFullscreen(false)} className={BTN_LG} title="Close (Esc)">
              <Minimize2 className="w-5 h-5" />
            </button>
          </div>
        </div>
        {configEditing ? (
          <textarea
            value={yamlDraft}
            onChange={(e) => setYamlDraft(e.target.value)}
            className="w-full min-h-[calc(100vh-80px)] p-6 bg-transparent text-sm font-mono text-text-primary leading-relaxed focus:outline-none resize-none"
            spellCheck={false}
            autoFocus
          />
        ) : (
          <pre className="text-sm font-mono text-text-secondary leading-relaxed whitespace-pre">
            {yamlText}
          </pre>
        )}
      </FullscreenOverlay>
    </div>
  );
}
