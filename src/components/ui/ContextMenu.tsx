import React, { useRef, useEffect } from 'react'
import './ContextMenu.css'
import type { MenuOption } from '../../types'

interface ContextMenuProps {
  shown: boolean
  options: MenuOption[]
  item?: any
  onMenuClosed?: () => void
  onOptionClicked?: (data: { item: any; option: string }) => void
  children?: React.ReactNode
}

const ContextMenu: React.FC<ContextMenuProps> = ({
  shown,
  options,
  item,
  onMenuClosed,
  children
}) => {
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const isLinkedData = (item: any) => {
    if (item?.instance?.linked_data) {
      return true
    } else if (item?.linked_data) {
      return true
    }
    return false
  }

  const hideContextMenu = () => {
    onMenuClosed?.()
  }


  const handleClickOutside = (event: MouseEvent) => {
    const elements = document.elementsFromPoint(event.clientX, event.clientY)
    if (
      contextMenuRef.current &&
      contextMenuRef.current !== event.target &&
      !elements.includes(contextMenuRef.current)
    ) {
      hideContextMenu()
    }
  }

  const onEscKeyRelease = (event: KeyboardEvent) => {
    if (event.keyCode === 27) {
      hideContextMenu()
    }
  }

  useEffect(() => {
    const handleClick = (event: MouseEvent) => handleClickOutside(event)
    const handleKeyup = (event: KeyboardEvent) => onEscKeyRelease(event)

    window.addEventListener('click', handleClick)
    document.body.addEventListener('keyup', handleKeyup)

    return () => {
      window.removeEventListener('click', handleClick)
      document.body.removeEventListener('keyup', handleKeyup)
    }
  }, [])


  return (
    <div
      className={`context-menu ${shown ? 'fade-enter-active' : ''}`}
      ref={contextMenuRef}
      style={{
        left: '0px',
        top: '0px',
        display: shown ? 'block' : 'none',
      }}
    >
      {options.map((option, index) => (
        <React.Fragment key={index}>
          {option.type === 'divider' ? (
            <hr className="divider" />
          ) : (
            !(isLinkedData(item) && option.name === 'add_content') && (
              <div className={`item clickable ${option.color ?? 'base'}`}>
                {children}
              </div>
            )
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

export default ContextMenu