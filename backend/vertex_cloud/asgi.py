"""ASGI config for vertex_cloud project."""
import os
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'vertex_cloud.settings')
application = get_asgi_application()
