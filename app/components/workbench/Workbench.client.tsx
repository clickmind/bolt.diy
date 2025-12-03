// app/components/workbench/Workbench.v0.tsx
import { memo, useCallback, useEffect, useState, useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { motion } from 'framer-motion';
import { workbenchStore, type WorkbenchViewType } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { WorkbenchHeader } from './WorkbenchHeader';
import { EditorPanel } from './EditorPanel';
import { Preview } from './Preview';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('Workbench');

// Animation variants matching smooth transitions
const viewVariants = {
  preview: {
    x: '0%',
    transition: { duration: 0.3, ease: [0.31, 0.1, 0.08, 0.96] }
  },
  code: {
    x: '0%',
    transition: { duration: 0.3, ease: [0.31, 0.1, 0.08, 0.96] }
  },
  hidden: {
    x: '100%',
    transition: { duration: 0.3, ease: [0.31, 0.1, 0.08, 0.96] }
  }
};

interface WorkbenchProps {
  chatStarted?: boolean;
  isStreaming?: boolean;
  actionRunner?: any;
  className?: string;
}

export const WorkbenchV0 = memo<WorkbenchProps>(({
  chatStarted = false,
  isStreaming = false,
  actionRunner,
  className
}) => {
  const currentView = useStore(workbenchStore.currentView);
  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const selectedFile = useStore(workbenchStore.selectedFile);
  const currentDocument = useStore(workbenchStore.currentDocument);
  const unsavedFiles = useStore(workbenchStore.unsavedFiles);
  const files = useStore(workbenchStore.files);
  
  const [showConsole, setShowConsole] = useState(false);

  // Don't render until chat has started
  if (!chatStarted || !showWorkbench) {
    return null;
  }

  return (
    <div
      className={classNames(
        'flex flex-col h-full w-full bg-white dark:bg-[#0a0a0a] overflow-hidden',
        className
      )}
      data-workbench-v0
    >
      {/* Header */}
      <WorkbenchHeader 
        onRefresh={() => {
          logger.info('Refreshing preview');
          // Trigger preview refresh
        }}
        onExport={() => {
          logger.info('Exporting project');
          workbenchStore.downloadZip();
        }}
      />

      {/* Main Content Area */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        {/* Preview View */}
        <motion.div
          className="absolute inset-0"
          initial={false}
          animate={currentView === 'preview' ? 'preview' : 'hidden'}
          variants={viewVariants}
          style={{ 
            backgroundColor: 'rgb(250, 250, 250)',
            zIndex: currentView === 'preview' ? 2 : 1
          }}
        >
          <Preview
            actionRunner={actionRunner}
            showConsole={showConsole}
            setShowConsole={setShowConsole}
            isInspectorActive={false}
          />
        </motion.div>

        {/* Code View */}
        <motion.div
          className="absolute inset-0"
          initial={false}
          animate={currentView === 'code' ? 'code' : 'hidden'}
          variants={viewVariants}
          style={{ 
            zIndex: currentView === 'code' ? 2 : 1
          }}
        >
          <EditorPanel
            editorDocument={currentDocument}
            isStreaming={isStreaming}
            selectedFile={selectedFile}
            files={files}
            unsavedFiles={unsavedFiles}
            onFileSelect={(filePath) => {
              workbenchStore.setSelectedFile(filePath);
            }}
            onEditorScroll={(position) => {
              workbenchStore.setCurrentDocumentScrollPosition(position);
            }}
            onEditorChange={(update) => {
              workbenchStore.setCurrentDocumentContent(update.content);
            }}
            onFileSave={() => {
              workbenchStore.saveCurrentDocument();
            }}
            onFileReset={() => {
              workbenchStore.resetCurrentDocument();
            }}
          />
        </motion.div>

        {/* Minimal Loading Overlay*/}
        {isStreaming && (
          <div className="absolute bottom-4 left-4 z-50">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-[#1a1a1a] border border-[#e5e7eb] dark:border-[#27272f] shadow-lg">
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-sm text-[#6b7280] dark:text-[#9ca3af]">
                Generating...
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Edge Indicator  */}
      <div 
        className="absolute bottom-0 left-0 right-0 h-[2px] opacity-0 pointer-events-none transition-opacity"
        style={{
          background: 'linear-gradient(to right, transparent, rgb(59, 130, 246), transparent)',
          opacity: isStreaming ? 1 : 0
        }}
      />
    </div>
  );
});

WorkbenchV0.displayName = 'WorkbenchV0';
