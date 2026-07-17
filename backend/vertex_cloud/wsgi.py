"""WSGI config for vertex_cloud project."""
import os
from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'vertex_cloud.settings')
application = get_wsgi_application()
