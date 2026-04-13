import { PageHeader } from '../../../components/common/layout/PageHeader';
import { CollapsibleSection } from '../../../components/common/layout/CollapsibleSection';
import { PipelineStrip, StepDetail } from './PipelineStrip';
import { LifecycleSidebar } from './LifecycleSidebar';
import { InvokeSection } from './InvokeSection';
import { ConfigurationSection } from './ConfigurationSection';
import { VersionHistory } from './VersionHistory';
import { HeaderCard } from './HeaderCard';
import { useWorkflowDetail } from './useWorkflowDetail';

export function YamlWorkflowDetailPage() {
  const d = useWorkflowDetail();

  if (d.isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-48" />
        <div className="h-60 bg-surface-sunken rounded" />
      </div>
    );
  }

  if (!d.wf) {
    return <p className="text-sm text-text-secondary">Workflow server not found.</p>;
  }

  const wf = d.wf;

  return (
    <div>
      <PageHeader
        title="Workflow Tool"
        actions={
          wf.status === 'draft' && !d.isViewingHistory ? (
            <button
              onClick={d.handleDeploy}
              disabled={d.lifecyclePending}
              className="group flex items-center gap-2 text-left"
            >
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-accent/10 text-accent shrink-0">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.674M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </span>
              <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors">
                <span className="inline-flex items-center px-2 py-0.5 rounded bg-accent/10 text-accent font-medium group-hover:bg-accent/20 transition-colors mr-1">Deploy</span>
                {' '}to register <span className="font-mono font-medium text-text-primary">{wf.app_id}/{wf.graph_topic}</span> as an MCP Workflow Tool.
              </span>
            </button>
          ) : undefined
        }
      />

      {/* History banner */}
      {d.isViewingHistory && (
        <div className="mb-6 px-4 py-3 rounded-md bg-purple-500/10 border border-purple-500/20 flex items-center justify-between">
          <p className="text-xs text-text-primary">
            Viewing version <span className="font-mono font-medium">{d.viewingVersion}</span>
            {d.versionSnapshot?.change_summary && (
              <span className="text-text-tertiary ml-2">— {d.versionSnapshot.change_summary}</span>
            )}
            <span className="ml-2 text-text-tertiary">(read-only)</span>
          </p>
          <button
            onClick={() => { const next = new URLSearchParams(d.searchParams); next.delete('version'); d.setSearchParams(next); }}
            className="text-xs text-accent hover:underline"
          >
            Back to current
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-12">
        {/* ── Left: main content ─────────────────────────── */}
        <div>
          <HeaderCard
            wf={wf}
            workerActivities={d.workerActivities}
            isActive={d.isActive}
            isViewingHistory={d.isViewingHistory}
            versionsData={d.versionsData}
            onOpenInvoke={() => d.toggleSection('invoke')}
          />

          {/* ── Collapsible sections ─────────────────────── */}
          <div className="space-y-6">

            {/* ── Invoke / Try ────────────────────────────── */}
            {d.showInvoke && (
              <InvokeSection
                wf={wf}
                inputSchema={d.resolvedInputSchema}
                invokeFields={d.invokeFields}
                setInvokeFields={d.setInvokeFields}
                invokeJson={d.invokeJson}
                setInvokeJson={d.setInvokeJson}
                invokeJsonMode={d.invokeJsonMode}
                setInvokeJsonMode={d.setInvokeJsonMode}
                invokeResult={d.invokeResult}
                setInvokeResult={d.setInvokeResult}
                showMetadata={d.showMetadata}
                setShowMetadata={d.setShowMetadata}
                invokeMutation={d.invokeMutation}
                inputFieldMeta={wf.input_field_meta}
                settings={d.settings}
                onInvoke={d.handleInvoke}
                isCollapsed={d.openSection !== 'invoke'}
                onToggle={d.toggleSection}
              />
            )}

            {/* ── Tools ──────────────────────────────────── */}
            <CollapsibleSection sectionKey="tools" title="Tools" isCollapsed={d.openSection !== 'tools'} onToggle={d.toggleSection} >
              <div className="space-y-4">
                <PipelineStrip
                  activities={d.workerActivities}
                  selectedIdx={d.selectedStep}
                  onSelect={d.setSelectedStep}
                />

                {d.workerActivities[d.selectedStep] && (
                  <StepDetail activity={d.workerActivities[d.selectedStep]} />
                )}
              </div>
            </CollapsibleSection>

            {/* ── Config ─────────────────────────────────── */}
            <ConfigurationSection
              wf={wf}
              resolvedInputSchema={d.resolvedInputSchema}
              resolvedOutputSchema={d.resolvedOutputSchema}
              resolvedYaml={d.resolvedYaml}
              configEditing={d.configEditing}
              setConfigEditing={d.setConfigEditing}
              canEditConfig={d.canEditConfig}
              yamlDraft={d.yamlDraft}
              setYamlDraft={d.setYamlDraft}
              inputSchemaDraft={d.inputSchemaDraft}
              setInputSchemaDraft={d.setInputSchemaDraft}
              outputSchemaDraft={d.outputSchemaDraft}
              setOutputSchemaDraft={d.setOutputSchemaDraft}
              inputFieldMetaDraft={d.inputFieldMetaDraft}
              setInputFieldMetaDraft={d.setInputFieldMetaDraft}
              onSave={d.handleSaveConfig}
              onCancel={d.handleCancelEdit}
              updateMutation={d.updateMutation}
              yamlTextareaRef={d.yamlTextareaRef}
              isCollapsed={d.openSection !== 'config'}
              onToggle={d.toggleSection}
            />

          </div>
        </div>

        {/* ── Right sidebar: lifecycle ────────────────────── */}
        <div className="lg:border-l lg:border-surface-border lg:pl-8 space-y-8">
          <LifecycleSidebar
            status={wf.status}
            sourceWorkflowId={wf.source_workflow_id}
            contentVersion={wf.content_version}
            deployedContentVersion={wf.deployed_content_version}
            onDeploy={d.handleDeploy}

            onArchive={d.handleArchive}
            onDelete={d.handleDelete}
            onRegenerate={d.handleRegenerate}
            isPending={d.lifecyclePending}
            error={d.lifecycleError}
          />

          {/* Version history */}
          {d.versionsData && d.versionsData.versions.length > 1 && (
            <VersionHistory
              versionsData={d.versionsData}
              searchParams={d.searchParams}
              setSearchParams={d.setSearchParams}
              currentVersion={wf.content_version}
              viewingVersion={d.viewingVersion}
            />
          )}
        </div>
      </div>
    </div>
  );
}
