"""PyInstaller entry point — freezes to the self-contained 푸르름.app."""
import sys

from quarto_viewer.app import main

if __name__ == "__main__":
    sys.exit(main())
