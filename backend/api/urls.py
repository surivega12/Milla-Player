from django.urls import path
from .views import LyricsEndpointView, AudioDSPAnalyzeView

urlpatterns = [
    path('lyrics/', LyricsEndpointView.as_view(), name='api-lyrics'),
    path('analyze/', AudioDSPAnalyzeView.as_view(), name='api-analyze'),
]
