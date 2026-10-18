/**
 * The side panel's Files tab (#55 D5, D6): the open card's folder (`folder`, its directory, or
 * the workspace's folder for a shell). Over SSH it only says files aren't available (D6): nothing
 * is listed and no git runs. The tree of a local folder comes in a later slice.
 */
function FilesTab({ folder, ssh }: { folder: string; ssh: boolean }): React.JSX.Element {
  if (ssh) {
    return (
      <div className="files-tab files-tab-message" data-testid="files-tab">
        Files aren&apos;t available over SSH yet
      </div>
    )
  }
  return <div className="files-tab" data-testid="files-tab" data-folder={folder} />
}

export default FilesTab
