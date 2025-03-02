import { defineComponent } from 'vue'
import { mapActions } from 'vuex'
import fs from 'fs/promises'
import FtLoader from '../../components/ft-loader/ft-loader.vue'
import FtVideoPlayer from '../../components/ft-video-player/ft-video-player.vue'
import WatchVideoInfo from '../../components/watch-video-info/watch-video-info.vue'
import WatchVideoChapters from '../../components/watch-video-chapters/watch-video-chapters.vue'
import WatchVideoDescription from '../../components/watch-video-description/watch-video-description.vue'
import WatchVideoComments from '../../components/watch-video-comments/watch-video-comments.vue'
import WatchVideoLiveChat from '../../components/watch-video-live-chat/watch-video-live-chat.vue'
import WatchVideoPlaylist from '../../components/watch-video-playlist/watch-video-playlist.vue'
import WatchVideoRecommendations from '../../components/watch-video-recommendations/watch-video-recommendations.vue'
import FtAgeRestricted from '../../components/ft-age-restricted/ft-age-restricted.vue'
import { pathExists } from '../../helpers/filesystem'
import {
  buildVTTFileLocally,
  copyToClipboard,
  extractNumberFromString,
  formatDurationAsTimestamp,
  formatNumber,
  getFormatsFromHLSManifest,
  getUserDataPath,
  showToast
} from '../../helpers/utils'
import {
  getLocalVideoInfo,
  mapLocalFormat,
  parseLocalTextRuns,
  parseLocalWatchNextVideo
} from '../../helpers/api/local'
import { invidiousGetVideoInformation, youtubeImageUrlToInvidious } from '../../helpers/api/invidious'

export default defineComponent({
  name: 'Watch',
  components: {
    'ft-loader': FtLoader,
    'ft-video-player': FtVideoPlayer,
    'watch-video-info': WatchVideoInfo,
    'watch-video-chapters': WatchVideoChapters,
    'watch-video-description': WatchVideoDescription,
    'watch-video-comments': WatchVideoComments,
    'watch-video-live-chat': WatchVideoLiveChat,
    'watch-video-playlist': WatchVideoPlaylist,
    'watch-video-recommendations': WatchVideoRecommendations,
    'ft-age-restricted': FtAgeRestricted
  },
  beforeRouteLeave: function (to, from, next) {
    this.handleRouteChange(this.videoId)
    window.removeEventListener('beforeunload', this.handleWatchProgress)
    next()
  },
  data: function () {
    return {
      isLoading: true,
      firstLoad: true,
      useTheatreMode: false,
      showDashPlayer: true,
      showLegacyPlayer: false,
      showYouTubeNoCookieEmbed: false,
      hidePlayer: false,
      isFamilyFriendly: false,
      isLive: false,
      liveChat: null,
      isLiveContent: false,
      isUpcoming: false,
      upcomingTimestamp: null,
      upcomingTimeLeft: null,
      activeFormat: 'legacy',
      thumbnail: '',
      videoId: '',
      videoTitle: '',
      videoDescription: '',
      videoDescriptionHtml: '',
      videoViewCount: 0,
      videoLikeCount: 0,
      videoDislikeCount: 0,
      videoLengthSeconds: 0,
      videoChapters: [],
      videoCurrentChapterIndex: 0,
      channelName: '',
      channelThumbnail: '',
      channelId: '',
      channelSubscriptionCountText: '',
      videoPublished: 0,
      videoStoryboardSrc: '',
      audioUrl: '',
      dashSrc: [],
      activeSourceList: [],
      videoSourceList: [],
      audioSourceList: [],
      adaptiveFormats: [],
      captionHybridList: [], // [] -> Promise[] -> string[] (URIs)
      recommendedVideos: [],
      downloadLinks: [],
      watchingPlaylist: false,
      playlistId: '',
      timestamp: null,
      playNextTimeout: null,
      playNextCountDownIntervalId: null,
      pictureInPictureButtonInverval: null,
      infoAreaSticky: true
    }
  },
  computed: {
    historyCache: function () {
      return this.$store.getters.getHistoryCache
    },
    rememberHistory: function () {
      return this.$store.getters.getRememberHistory
    },
    removeVideoMetaFiles: function () {
      return this.$store.getters.getRemoveVideoMetaFiles
    },
    saveWatchedProgress: function () {
      return this.$store.getters.getSaveWatchedProgress
    },
    backendPreference: function () {
      return this.$store.getters.getBackendPreference
    },
    backendFallback: function () {
      return this.$store.getters.getBackendFallback
    },
    currentInvidiousInstance: function () {
      return this.$store.getters.getCurrentInvidiousInstance
    },
    proxyVideos: function () {
      return this.$store.getters.getProxyVideos
    },
    defaultInterval: function () {
      return this.$store.getters.getDefaultInterval
    },
    defaultTheatreMode: function () {
      return this.$store.getters.getDefaultTheatreMode
    },
    defaultVideoFormat: function () {
      return this.$store.getters.getDefaultVideoFormat
    },
    forceLocalBackendForLegacy: function () {
      return this.$store.getters.getForceLocalBackendForLegacy
    },
    thumbnailPreference: function () {
      return this.$store.getters.getThumbnailPreference
    },
    playNextVideo: function () {
      return this.$store.getters.getPlayNextVideo
    },
    autoplayPlaylists: function () {
      return this.$store.getters.getAutoplayPlaylists
    },
    hideRecommendedVideos: function () {
      return this.$store.getters.getHideRecommendedVideos
    },
    hideLiveChat: function () {
      return this.$store.getters.getHideLiveChat
    },
    hideComments: function () {
      return this.$store.getters.getHideComments
    },
    hideVideoDescription: function () {
      return this.$store.getters.getHideVideoDescription
    },
    showFamilyFriendlyOnly: function() {
      return this.$store.getters.getShowFamilyFriendlyOnly
    },
    hideChannelSubscriptions: function () {
      return this.$store.getters.getHideChannelSubscriptions
    },
    hideVideoLikesAndDislikes: function () {
      return this.$store.getters.getHideVideoLikesAndDislikes
    },
    theatrePossible: function () {
      return !this.hideRecommendedVideos || (!this.hideLiveChat && this.isLive) || this.watchingPlaylist
    },
    currentLocale: function () {
      return this.$i18n.locale.replace('_', '-')
    },
    hideChapters: function () {
      return this.$store.getters.getHideChapters
    }
  },
  watch: {
    $route() {
      this.handleRouteChange(this.videoId)
      // react to route changes...
      this.videoId = this.$route.params.id

      this.firstLoad = true
      this.activeFormat = this.defaultVideoFormat
      this.videoStoryboardSrc = ''
      this.captionHybridList = []
      this.downloadLinks = []

      this.checkIfPlaylist()
      this.checkIfTimestamp()

      switch (this.backendPreference) {
        case 'local':
          this.getVideoInformationLocal(this.videoId)
          break
        case 'invidious':
          this.getVideoInformationInvidious(this.videoId)

          if (this.forceLocalBackendForLegacy) {
            this.getVideoInformationLocal(this.videoId)
          }
          break
      }
    },
    activeFormat: function (format) {
      clearInterval(this.pictureInPictureButtonInverval)

      // only hide/show the button once the player is available
      this.pictureInPictureButtonInverval = setInterval(() => {
        if (!this.hidePlayer) {
          const pipButton = document.querySelector('.vjs-picture-in-picture-control')
          if (pipButton === null) {
            return
          }
          if (format === 'audio') {
            pipButton.classList.add('vjs-hidden')
          } else {
            pipButton.classList.remove('vjs-hidden')
          }
          clearInterval(this.pictureInPictureButtonInverval)
        }
      }, 100)
    }
  },
  mounted: function () {
    this.videoId = this.$route.params.id
    this.activeFormat = this.defaultVideoFormat
    this.useTheatreMode = this.defaultTheatreMode

    this.checkIfPlaylist()
    this.checkIfTimestamp()

    if (!process.env.IS_ELECTRON || this.backendPreference === 'invidious') {
      this.getVideoInformationInvidious()
    } else {
      this.getVideoInformationLocal()
    }

    window.addEventListener('beforeunload', this.handleWatchProgress)
  },
  methods: {
    changeTimestamp: function (timestamp) {
      this.$refs.videoPlayer.player.currentTime(timestamp)
    },
    toggleTheatreMode: function () {
      this.useTheatreMode = !this.useTheatreMode
    },

    getVideoInformationLocal: async function () {
      if (this.firstLoad) {
        this.isLoading = true
      }

      try {
        let result = await getLocalVideoInfo(this.videoId)

        this.isFamilyFriendly = result.basic_info.is_family_safe

        this.recommendedVideos = result.watch_next_feed
          ?.filter((item) => item.type === 'CompactVideo')
          .map(parseLocalWatchNextVideo) ?? []

        if (this.showFamilyFriendlyOnly && !this.isFamilyFriendly) {
          this.isLoading = false
          this.handleVideoEnded()
          return
        }

        let playabilityStatus = result.playability_status
        let bypassedResult = null
        if (playabilityStatus.status === 'LOGIN_REQUIRED') {
          // try to bypass the age restriction
          bypassedResult = await getLocalVideoInfo(this.videoId, true)
          playabilityStatus = result.playability_status
        }

        if (playabilityStatus.status === 'UNPLAYABLE') {
          /**
           * @typedef {import('youtubei.js/dist/src/parser/classes/PlayerErrorMessage').default} PlayerErrorMessage
           * @type {PlayerErrorMessage}
           */
          const errorScreen = playabilityStatus.error_screen
          throw new Error(`[${playabilityStatus.status}] ${errorScreen.reason.text}: ${errorScreen.subreason.text}`)
        }

        // extract localised title first and fall back to the not localised one
        this.videoTitle = result.primary_info?.title.text ?? result.basic_info.title
        this.videoViewCount = result.basic_info.view_count

        this.channelId = result.basic_info.channel_id
        this.channelName = result.basic_info.author

        if (result.secondary_info.owner?.author) {
          this.channelThumbnail = result.secondary_info.owner.author.best_thumbnail?.url ?? ''
        } else {
          this.channelThumbnail = ''
        }

        this.updateSubscriptionDetails({
          channelThumbnailUrl: this.channelThumbnail.length === 0 ? null : this.channelThumbnail,
          channelName: this.channelName,
          channelId: this.channelId
        })

        this.videoPublished = new Date(result.page[0].microformat.publish_date.replace('-', '/')).getTime()

        if (result.secondary_info?.description.runs) {
          try {
            this.videoDescription = parseLocalTextRuns(result.secondary_info.description.runs)
          } catch (error) {
            console.error('Failed to extract the localised description, falling back to the standard one.', error, JSON.stringify(result.secondary_info.description.runs))
            this.videoDescription = result.basic_info.short_description
          }
        } else {
          this.videoDescription = result.basic_info.short_description
        }

        switch (this.thumbnailPreference) {
          case 'start':
            this.thumbnail = `https://i.ytimg.com/vi/${this.videoId}/maxres1.jpg`
            break
          case 'middle':
            this.thumbnail = `https://i.ytimg.com/vi/${this.videoId}/maxres2.jpg`
            break
          case 'end':
            this.thumbnail = `https://i.ytimg.com/vi/${this.videoId}/maxres3.jpg`
            break
          default:
            this.thumbnail = result.basic_info.thumbnail[0].url
            break
        }

        if (this.hideVideoLikesAndDislikes) {
          this.videoLikeCount = null
          this.videoDislikeCount = null
        } else {
          this.videoLikeCount = isNaN(result.basic_info.like_count) ? 0 : result.basic_info.like_count

          // YouTube doesn't return dislikes anymore
          this.videoDislikeCount = 0
        }

        this.isLive = !!result.basic_info.is_live
        this.isUpcoming = !!result.basic_info.is_upcoming
        this.isLiveContent = !!result.basic_info.is_live_content

        if (!this.hideChannelSubscriptions) {
          // really not a fan of this :(, YouTube returns the subscribers as "15.1M subscribers"
          // so we have to parse it somehow
          const rawSubCount = result.secondary_info.owner.subscriber_count.text
          const match = rawSubCount
            .replace(',', '.')
            .toUpperCase()
            .match(/([\d.]+)\s*([KM]?)/)
          let subCount
          if (match) {
            subCount = parseFloat(match[1])

            if (match[2] === 'K') {
              subCount *= 1000
            } else if (match[2] === 'M') {
              subCount *= 1000_000
            }

            subCount = Math.trunc(subCount)
          } else {
            subCount = extractNumberFromString(rawSubCount)
          }

          if (!isNaN(subCount)) {
            if (subCount >= 10000) {
              this.channelSubscriptionCountText = formatNumber(subCount, { notation: 'compact' })
            } else {
              this.channelSubscriptionCountText = formatNumber(subCount)
            }
          } else {
            this.channelSubscriptionCountText = ''
          }
        } else {
          this.channelSubscriptionCountText = ''
        }

        const chapters = []
        if (!this.hideChapters) {
          const rawChapters = result.player_overlays?.decorated_player_bar?.player_bar?.markers_map?.get({ marker_key: 'DESCRIPTION_CHAPTERS' })?.value.chapters
          if (rawChapters) {
            for (const chapter of rawChapters) {
              const start = chapter.time_range_start_millis / 1000

              chapters.push({
                title: chapter.title.text,
                timestamp: formatDurationAsTimestamp(start),
                startSeconds: start,
                endSeconds: 0,
                thumbnail: chapter.thumbnail[0].url
              })
            }

            this.addChaptersEndSeconds(chapters, result.basic_info.duration)

            // prevent vue from adding reactivity which isn't needed
            // as the chapter objects are read-only after this anyway
            // the chapters are checked for every timeupdate event that the player emits
            // this should lessen the performance and memory impact of the chapters
            chapters.forEach(Object.freeze)
          }
        }

        this.videoChapters = chapters

        if (!this.hideLiveChat && this.isLive && this.isLiveContent && result.livechat) {
          this.liveChat = result.getLiveChat()
        } else {
          this.liveChat = null
        }

        // the bypassed result is missing some of the info that we extract in the code above
        // so we only overwrite the result here
        // we need the bypassed result for the streaming data and the subtitles
        if (bypassedResult) {
          result = bypassedResult
        }

        if ((this.isLive && this.isLiveContent) && !this.isUpcoming) {
          try {
            const formats = await getFormatsFromHLSManifest(result.streaming_data.hls_manifest_url)

            this.videoSourceList = formats
              .sort((formatA, formatB) => {
                return formatB.height - formatA.height
              })
              .map((format) => {
                return {
                  url: format.url,
                  type: 'application/x-mpegURL',
                  label: 'Dash',
                  qualityLabel: `${format.height}p`
                }
              })
          } catch (e) {
            console.error('Failed to extract formats form HLS manifest, falling back to passing it directly to video.js', e)

            this.videoSourceList = [
              {
                url: result.streaming_data.hls_manifest_url,
                type: 'application/x-mpegURL',
                label: 'Dash',
                qualityLabel: 'Live'
              }
            ]
          }

          this.showLegacyPlayer = true
          this.showDashPlayer = false
          this.activeFormat = 'legacy'
          this.activeSourceList = this.videoSourceList
        } else if (this.isUpcoming) {
          const upcomingTimestamp = result.basic_info.start_timestamp

          if (upcomingTimestamp) {
            const timestampOptions = {
              month: 'long',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit'
            }
            const now = new Date()
            if (now.getFullYear() < upcomingTimestamp.getFullYear()) {
              Object.defineProperty(timestampOptions, 'year', {
                value: 'numeric'
              })
            }
            this.upcomingTimestamp = Intl.DateTimeFormat(this.currentLocale, timestampOptions).format(upcomingTimestamp)

            let upcomingTimeLeft = upcomingTimestamp - now

            // Convert from ms to second to minute
            upcomingTimeLeft = (upcomingTimeLeft / 1000) / 60
            let timeUnit = 'minute'

            // Youtube switches to showing time left in minutes at 120 minutes remaining
            if (upcomingTimeLeft > 120) {
              upcomingTimeLeft /= 60
              timeUnit = 'hour'
            }

            if (timeUnit === 'hour' && upcomingTimeLeft > 24) {
              upcomingTimeLeft /= 24
              timeUnit = 'day'
            }

            // Value after decimal not to be displayed
            // e.g. > 2 days = display as `2 days`
            upcomingTimeLeft = Math.floor(upcomingTimeLeft)

            // Displays when less than a minute remains
            // Looks better than `Premieres in x seconds`
            if (upcomingTimeLeft < 1) {
              this.upcomingTimeLeft = this.$t('Video.Published.In less than a minute').toLowerCase()
            } else {
              // TODO a I18n entry for time format might be needed here
              this.upcomingTimeLeft = new Intl.RelativeTimeFormat(this.currentLocale).format(upcomingTimeLeft, timeUnit)
            }
          } else {
            this.upcomingTimestamp = null
            this.upcomingTimeLeft = null
          }
        } else {
          this.videoLengthSeconds = result.basic_info.duration
          if (result.streaming_data) {
            if (result.streaming_data.formats.length > 0) {
              this.videoSourceList = result.streaming_data.formats.map(mapLocalFormat).reverse()
            } else {
              this.videoSourceList = result.streaming_data.adaptive_formats.map(mapLocalFormat).reverse()
            }
            this.adaptiveFormats = this.videoSourceList

            const formats = [...result.streaming_data.formats, ...result.streaming_data.adaptive_formats]
            this.downloadLinks = formats.map((format) => {
              const qualityLabel = format.quality_label ?? format.bitrate
              const fps = format.fps ? `${format.fps}fps` : 'kbps'
              const type = format.mime_type.match(/.*;/)[0].replace(';', '')
              let label = `${qualityLabel} ${fps} - ${type}`

              if (format.has_audio !== format.has_video) {
                if (format.has_video) {
                  label += ` ${this.$t('Video.video only')}`
                } else {
                  label += ` ${this.$t('Video.audio only')}`
                }
              }

              return {
                url: format.url,
                label: label
              }
            })

            if (result.captions) {
              const captionTracks = result.captions.caption_tracks.map((caption) => {
                return {
                  url: caption.base_url,
                  label: caption.name.text,
                  language_code: caption.language_code,
                  kind: caption.kind
                }
              })
              if (this.currentLocale) {
                const noLocaleCaption = !captionTracks.some(track =>
                  track.language_code === this.currentLocale && track.kind !== 'asr'
                )

                if (!this.currentLocale.startsWith('en') && noLocaleCaption) {
                  captionTracks.forEach((caption) => {
                    this.tryAddingTranslatedLocaleCaption(captionTracks, this.currentLocale, caption.url)
                  })
                }
              }

              this.captionHybridList = this.createCaptionPromiseList(captionTracks)

              const captionLinks = captionTracks.map((caption) => {
                const label = `${caption.label} (${caption.language_code}) - text/vtt`

                return {
                  url: caption.url,
                  label: label
                }
              })

              this.downloadLinks = this.downloadLinks.concat(captionLinks)
            }
          } else {
            // video might be region locked or something else. This leads to no formats being available
            showToast(
              this.$t('This video is unavailable because of missing formats. This can happen due to country unavailability.'),
              7000
            )
            this.handleVideoEnded()
            return
          }

          if (result.streaming_data?.adaptive_formats.length > 0) {
            this.adaptiveFormats = result.streaming_data.adaptive_formats.map(mapLocalFormat)
            if (this.proxyVideos) {
              this.dashSrc = await this.createInvidiousDashManifest()
            } else {
              this.dashSrc = await this.createLocalDashManifest(result)
            }

            this.audioSourceList = result.streaming_data.adaptive_formats.filter((format) => {
              return format.has_audio
            }).sort((a, b) => {
              return a.bitrate - b.bitrate
            }).map((format, index) => {
              const label = (x) => {
                switch (x) {
                  case 0:
                    return this.$t('Video.Audio.Low')
                  case 1:
                    return this.$t('Video.Audio.Medium')
                  case 2:
                    return this.$t('Video.Audio.High')
                  case 3:
                    return this.$t('Video.Audio.Best')
                  default:
                    return format.bitrate
                }
              }
              return {
                url: format.url,
                type: format.mime_type,
                label: 'Audio',
                qualityLabel: label(index)
              }
            }).reverse()

            if (this.activeFormat === 'audio') {
              this.activeSourceList = this.audioSourceList
            } else {
              this.activeSourceList = this.videoSourceList
            }
          } else {
            this.activeSourceList = this.videoSourceList
            this.audioSourceList = null
            this.dashSrc = null
            this.enableLegacyFormat()
          }

          if (result.storyboards?.type === 'PlayerStoryboardSpec') {
            await this.createLocalStoryboardUrls(result.storyboards.boards[2])
          }
        }

        this.isLoading = false
        this.updateTitle()
      } catch (err) {
        const errorMessage = this.$t('Local API Error (Click to copy)')
        showToast(`${errorMessage}: ${err}`, 10000, () => {
          copyToClipboard(err)
        })
        console.error(err)
        if (this.backendPreference === 'local' && this.backendFallback && !err.toString().includes('private')) {
          showToast(this.$t('Falling back to Invidious API'))
          this.getVideoInformationInvidious()
        } else {
          this.isLoading = false
        }
      }
    },

    getVideoInformationInvidious: function () {
      if (this.firstLoad) {
        this.isLoading = true
      }

      this.dashSrc = this.createInvidiousDashManifest()
      this.videoStoryboardSrc = `${this.currentInvidiousInstance}/api/v1/storyboards/${this.videoId}?height=90`

      invidiousGetVideoInformation(this.videoId)
        .then(result => {
          if (result.error) {
            throw new Error(result.error)
          }

          this.videoTitle = result.title
          this.videoViewCount = result.viewCount
          if (this.hideVideoLikesAndDislikes) {
            this.videoLikeCount = null
            this.videoDislikeCount = null
          } else {
            this.videoLikeCount = result.likeCount
            this.videoDislikeCount = result.dislikeCount
          }
          if (this.hideChannelSubscriptions) {
            this.channelSubscriptionCountText = ''
          } else {
            this.channelSubscriptionCountText = result.subCountText || 'FT-0'
          }
          this.channelId = result.authorId
          this.channelName = result.author
          const channelThumb = result.authorThumbnails[1]
          this.channelThumbnail = channelThumb ? youtubeImageUrlToInvidious(channelThumb.url, this.currentInvidiousInstance) : ''
          this.updateSubscriptionDetails({
            channelThumbnailUrl: channelThumb?.url,
            channelName: result.author,
            channelId: result.authorId
          })

          this.videoPublished = result.published * 1000
          this.videoDescriptionHtml = result.descriptionHtml
          this.recommendedVideos = result.recommendedVideos
          this.adaptiveFormats = result.adaptiveFormats.map((format) => {
            format.bitrate = parseInt(format.bitrate)
            if (typeof format.resolution !== 'undefined') {
              format.height = parseInt(format.resolution.replace('p', ''))
            }
            return format
          })
          this.isLive = result.liveNow
          this.isFamilyFriendly = result.isFamilyFriendly
          this.captionHybridList = result.captions.map(caption => {
            caption.url = this.currentInvidiousInstance + caption.url
            caption.type = ''
            caption.dataSource = 'invidious'
            return caption
          })

          switch (this.thumbnailPreference) {
            case 'start':
              this.thumbnail = `${this.currentInvidiousInstance}/vi/${this.videoId}/maxres1.jpg`
              break
            case 'middle':
              this.thumbnail = `${this.currentInvidiousInstance}/vi/${this.videoId}/maxres2.jpg`
              break
            case 'end':
              this.thumbnail = `${this.currentInvidiousInstance}/vi/${this.videoId}/maxres3.jpg`
              break
            default:
              this.thumbnail = result.videoThumbnails[0].url
              break
          }

          const chapters = []
          if (!this.hideChapters) {
            // HH:MM:SS Text
            // MM:SS Text
            // HH:MM:SS - Text // separator is one of '-', '–', '•', '—'
            // MM:SS - Text
            // HH:MM:SS - HH:MM:SS - Text // end timestamp is ignored, separator is one of '-', '–', '—'
            // HH:MM - HH:MM - Text // end timestamp is ignored
            const chapterMatches = result.description.matchAll(/^(?<timestamp>((?<hours>\d+):)?(?<minutes>\d+):(?<seconds>\d+))(\s*[–—-]\s*(?:\d+:){1,2}\d+)?\s+([–—•-]\s*)?(?<title>.+)$/gm)

            for (const { groups } of chapterMatches) {
              let start = 60 * Number(groups.minutes) + Number(groups.seconds)

              if (groups.hours) {
                start += 3600 * Number(groups.hours)
              }

              // replace previous chapter with current one if they have an identical start time
              if (chapters.length > 0 && chapters[chapters.length - 1].startSeconds === start) {
                chapters.pop()
              }

              chapters.push({
                title: groups.title.trim(),
                timestamp: groups.timestamp,
                startSeconds: start,
                endSeconds: 0
              })
            }

            if (chapters.length > 0) {
              this.addChaptersEndSeconds(chapters, result.lengthSeconds)

              // prevent vue from adding reactivity which isn't needed
              // as the chapter objects are read-only after this anyway
              // the chapters are checked for every timeupdate event that the player emits
              // this should lessen the performance and memory impact of the chapters
              chapters.forEach(Object.freeze)
            }
          }
          this.videoChapters = chapters

          if (this.isLive) {
            this.showLegacyPlayer = true
            this.showDashPlayer = false
            this.activeFormat = 'legacy'

            this.videoSourceList = [
              {
                url: result.hlsUrl,
                type: 'application/x-mpegURL',
                label: 'Dash',
                qualityLabel: 'Live'
              }
            ]

            // Grabs the adaptive formats from Invidious.  Might be worth making these work.
            // The type likely needs to be changed in order for these to be played properly.
            // this.videoSourceList = result.adaptiveFormats.filter((format) => {
            //   if (typeof (format.type) !== 'undefined') {
            //     return format.type.includes('video/mp4')
            //   }
            // }).map((format) => {
            //   return {
            //     url: format.url,
            //     type: 'application/x-mpegURL',
            //     label: 'Dash',
            //     qualityLabel: format.qualityLabel
            //   }
            // })

            this.activeSourceList = this.videoSourceList
          } else if (this.forceLocalBackendForLegacy) {
            this.getLegacyFormats()
          } else {
            this.videoLengthSeconds = result.lengthSeconds
            this.videoSourceList = result.formatStreams.reverse()

            this.downloadLinks = result.adaptiveFormats.concat(this.videoSourceList).map((format) => {
              const qualityLabel = format.qualityLabel || format.bitrate
              const itag = parseInt(format.itag)
              const fps = format.fps ? (format.fps + 'fps') : 'kbps'
              const type = format.type.match(/.*;/)[0].replace(';', '')
              let label = `${qualityLabel} ${fps} - ${type}`

              if (itag !== 18 && itag !== 22) {
                if (type.includes('video')) {
                  label += ` ${this.$t('Video.video only')}`
                } else {
                  label += ` ${this.$t('Video.audio only')}`
                }
              }
              const object = {
                url: format.url,
                label: label
              }

              return object
            }).reverse().concat(result.captions.map((caption) => {
              const label = `${caption.label} (${caption.languageCode}) - text/vtt`
              const object = {
                url: caption.url,
                label: label
              }

              return object
            }))

            this.audioSourceList = result.adaptiveFormats.filter((format) => {
              return format.type.includes('audio')
            }).map((format) => {
              return {
                url: format.url,
                type: format.type,
                label: 'Audio',
                qualityLabel: parseInt(format.bitrate)
              }
            }).sort((a, b) => {
              return a.qualityLabel - b.qualityLabel
            })

            if (this.activeFormat === 'audio') {
              this.activeSourceList = this.audioSourceList
            } else {
              this.activeSourceList = this.videoSourceList
            }
          }

          this.updateTitle()

          this.isLoading = false
        })
        .catch(err => {
          console.error(err)
          const errorMessage = this.$t('Invidious API Error (Click to copy)')
          showToast(`${errorMessage}: ${err.responseText}`, 10000, () => {
            copyToClipboard(err.responseText)
          })
          console.error(err)
          if (process.env.IS_ELECTRON && this.backendPreference === 'invidious' && this.backendFallback) {
            showToast(this.$t('Falling back to Local API'))
            this.getVideoInformationLocal()
          } else {
            this.isLoading = false
          }
        })
    },

    addChaptersEndSeconds: function (chapters, videoLengthSeconds) {
      for (let i = 0; i < chapters.length - 1; i++) {
        chapters[i].endSeconds = chapters[i + 1].startSeconds
      }
      chapters.at(-1).endSeconds = videoLengthSeconds
    },

    updateCurrentChapter: function () {
      const chapters = this.videoChapters
      const currentSeconds = this.getTimestamp()
      const currentChapterStart = chapters[this.videoCurrentChapterIndex].startSeconds

      if (currentSeconds !== currentChapterStart) {
        let i = currentSeconds < currentChapterStart ? 0 : this.videoCurrentChapterIndex

        for (; i < chapters.length; i++) {
          if (currentSeconds < chapters[i].endSeconds) {
            this.videoCurrentChapterIndex = i
            break
          }
        }
      }
    },

    addToHistory: function (watchProgress) {
      const videoData = {
        videoId: this.videoId,
        title: this.videoTitle,
        author: this.channelName,
        authorId: this.channelId,
        published: this.videoPublished,
        description: this.videoDescription,
        viewCount: this.videoViewCount,
        lengthSeconds: this.videoLengthSeconds,
        watchProgress: watchProgress,
        timeWatched: new Date().getTime(),
        isLive: false,
        paid: false,
        type: 'video'
      }

      this.updateHistory(videoData)
    },

    handleWatchProgress: function () {
      if (this.rememberHistory && !this.isUpcoming && !this.isLoading && !this.isLive) {
        const player = this.$refs.videoPlayer.player

        if (player !== null && this.saveWatchedProgress) {
          const currentTime = this.getWatchedProgress()
          const payload = {
            videoId: this.videoId,
            watchProgress: currentTime
          }
          this.updateWatchProgress(payload)
        }
      }
    },

    checkIfWatched: function () {
      const historyIndex = this.historyCache.findIndex((video) => {
        return video.videoId === this.videoId
      })

      if (!this.isLive) {
        if (this.timestamp) {
          if (this.timestamp < 0) {
            this.$refs.videoPlayer.player.currentTime(0)
          } else if (this.timestamp > (this.videoLengthSeconds - 10)) {
            this.$refs.videoPlayer.player.currentTime(this.videoLengthSeconds - 10)
          } else {
            this.$refs.videoPlayer.player.currentTime(this.timestamp)
          }
        } else if (historyIndex !== -1) {
          const watchProgress = this.historyCache[historyIndex].watchProgress

          if (watchProgress < (this.videoLengthSeconds - 10)) {
            this.$refs.videoPlayer.player.currentTime(watchProgress)
          }
        }
      }

      if (this.rememberHistory) {
        if (this.timestamp) {
          this.addToHistory(this.timestamp)
        } else if (historyIndex !== -1) {
          this.addToHistory(this.historyCache[historyIndex].watchProgress)
        } else {
          this.addToHistory(0)
        }
      }
    },

    checkIfPlaylist: function () {
      if (typeof (this.$route.query) !== 'undefined') {
        this.playlistId = this.$route.query.playlistId

        if (typeof (this.playlistId) !== 'undefined') {
          this.watchingPlaylist = true
        } else {
          this.watchingPlaylist = false
        }
      } else {
        this.watchingPlaylist = false
      }
    },

    checkIfTimestamp: function () {
      if (typeof (this.$route.query) !== 'undefined') {
        try {
          this.timestamp = parseInt(this.$route.query.timestamp)
        } catch {
          this.timestamp = null
        }
      }
    },

    getLegacyFormats: function () {
      getLocalVideoInfo(this.videoId)
        .then(result => {
          this.videoSourceList = result.streaming_data.formats.map(mapLocalFormat)
        })
        .catch(err => {
          const errorMessage = this.$t('Local API Error (Click to copy)')
          showToast(`${errorMessage}: ${err}`, 10000, () => {
            copyToClipboard(err)
          })
          console.error(err)
          if (!process.env.IS_ELECTRON || (this.backendPreference === 'local' && this.backendFallback)) {
            showToast(this.$t('Falling back to Invidious API'))
            this.getVideoInformationInvidious()
          }
        })
    },

    enableDashFormat: function () {
      if (this.activeFormat === 'dash' || this.isLive) {
        return
      }

      if (this.dashSrc === null) {
        showToast(this.$t('Change Format.Dash formats are not available for this video'))
        return
      }
      const watchedProgress = this.getWatchedProgress()
      this.activeFormat = 'dash'
      this.hidePlayer = true

      setTimeout(() => {
        this.hidePlayer = false
        setTimeout(() => {
          const player = this.$refs.videoPlayer.player
          if (player !== null) {
            player.currentTime(watchedProgress)
          }
        }, 500)
      }, 100)
    },

    enableLegacyFormat: function () {
      if (this.activeFormat === 'legacy') {
        return
      }

      const watchedProgress = this.getWatchedProgress()
      this.activeFormat = 'legacy'
      this.activeSourceList = this.videoSourceList
      this.hidePlayer = true

      setTimeout(() => {
        this.hidePlayer = false
        setTimeout(() => {
          const player = this.$refs.videoPlayer.player
          if (player !== null) {
            player.currentTime(watchedProgress)
          }
        }, 500)
      }, 100)
    },

    enableAudioFormat: function () {
      if (this.activeFormat === 'audio') {
        return
      }

      if (this.audioSourceList === null) {
        showToast(this.$t('Change Format.Audio formats are not available for this video'))
        return
      }

      const watchedProgress = this.getWatchedProgress()
      this.activeFormat = 'audio'
      this.activeSourceList = this.audioSourceList
      this.hidePlayer = true

      setTimeout(() => {
        this.hidePlayer = false
        setTimeout(() => {
          const player = this.$refs.videoPlayer.player
          if (player !== null) {
            player.currentTime(watchedProgress)
          }
        }, 500)
      }, 100)
    },

    handleVideoEnded: function () {
      if ((!this.watchingPlaylist || !this.autoplayPlaylists) && !this.playNextVideo) {
        return
      }

      const nextVideoInterval = this.defaultInterval
      this.playNextTimeout = setTimeout(() => {
        const player = this.$refs.videoPlayer.player
        if (player !== null && player.paused()) {
          if (this.watchingPlaylist) {
            this.$refs.watchVideoPlaylist.playNextVideo()
          } else {
            const nextVideoId = this.recommendedVideos[0].videoId
            this.$router.push({
              path: `/watch/${nextVideoId}`
            })
            showToast(this.$t('Playing Next Video'))
          }
        }
      }, nextVideoInterval * 1000)

      let countDownTimeLeftInSecond = nextVideoInterval
      const showCountDownMessage = () => {
        // Will not display "Playing next video in no time" as it's too late to cancel
        // Also there is a separate message when playing next video
        if (countDownTimeLeftInSecond <= 0) {
          clearInterval(this.playNextCountDownIntervalId)
          return
        }

        // To avoid message flashing
        // `time` is manually tested to be 700
        const message = this.$tc('Playing Next Video Interval', countDownTimeLeftInSecond, { nextVideoInterval: countDownTimeLeftInSecond })
        showToast(message, 700, () => {
          clearTimeout(this.playNextTimeout)
          clearInterval(this.playNextCountDownIntervalId)
          showToast(this.$t('Canceled next video autoplay'))
        })

        // At least this var should be updated AFTER showing the message
        countDownTimeLeftInSecond = countDownTimeLeftInSecond - 1
      }
      // Execute once before scheduling it
      showCountDownMessage()
      this.playNextCountDownIntervalId = setInterval(showCountDownMessage, 1000)
    },

    handleRouteChange: async function (videoId) {
      // if the user navigates to another video, the ipc call for the userdata path
      // takes long enough for the video id to have already changed to the new one
      // receiving it as an arg instead of accessing it ourselves means we always have the right one

      clearTimeout(this.playNextTimeout)
      clearInterval(this.playNextCountDownIntervalId)
      this.videoChapters = []

      this.handleWatchProgress()

      if (!this.isUpcoming && !this.isLoading) {
        const player = this.$refs.videoPlayer.player

        if (player !== null && !player.paused() && player.isInPictureInPicture()) {
          setTimeout(() => {
            player.play()
            player.on('leavepictureinpicture', (event) => {
              const watchTime = player.currentTime()
              if (this.$route.fullPath.includes('/watch')) {
                const routeId = this.$route.params.id
                if (routeId === videoId) {
                  this.$refs.videoPlayer.$refs.video.currentTime = watchTime
                }
              }

              player.pause()
              player.dispose()
            })
          }, 200)
        }
      }

      if (process.env.IS_ELECTRON && this.removeVideoMetaFiles) {
        if (process.env.NODE_ENV === 'development') {
          const dashFileLocation = `static/dashFiles/${videoId}.xml`
          const vttFileLocation = `static/storyboards/${videoId}.vtt`
          // only delete the file it actually exists
          if (await pathExists(dashFileLocation)) {
            await fs.rm(dashFileLocation)
          }
          if (await pathExists(vttFileLocation)) {
            await fs.rm(vttFileLocation)
          }
        } else {
          const userData = await getUserDataPath()
          const dashFileLocation = `${userData}/dashFiles/${videoId}.xml`
          const vttFileLocation = `${userData}/storyboards/${videoId}.vtt`

          if (await pathExists(dashFileLocation)) {
            await fs.rm(dashFileLocation)
          }
          if (await pathExists(vttFileLocation)) {
            await fs.rm(vttFileLocation)
          }
        }
      }
    },

    handleVideoError: function (error) {
      console.error(error)
      if (this.isLive) {
        return
      }

      if (error.code === 4) {
        if (this.activeFormat === 'dash') {
          console.warn(
            'Unable to play dash formats.  Reverting to legacy formats...'
          )
          this.enableLegacyFormat()
        } else {
          this.enableDashFormat()
        }
      }
    },

    /**
     * @typedef {import('youtubei.js/dist/src/parser/youtube/VideoInfo').default} VideoInfo
     */
    /**
     * @param {VideoInfo} videoInfo
     */
    createLocalDashManifest: async function (videoInfo) {
      const xmlData = videoInfo.toDash()
      const userData = await getUserDataPath()
      let fileLocation
      let uriSchema
      if (process.env.NODE_ENV === 'development') {
        fileLocation = `static/dashFiles/${this.videoId}.xml`
        uriSchema = `dashFiles/${this.videoId}.xml`
        // if the location does not exist, writeFileSync will not create the directory, so we have to do that manually
        if (!(await pathExists('static/dashFiles/'))) {
          await fs.mkdir('static/dashFiles/')
        }

        if (await pathExists(fileLocation)) {
          await fs.rm(fileLocation)
        }
        await fs.writeFile(fileLocation, xmlData)
      } else {
        fileLocation = `${userData}/dashFiles/${this.videoId}.xml`
        uriSchema = `file://${fileLocation}`

        if (!(await pathExists(`${userData}/dashFiles/`))) {
          await fs.mkdir(`${userData}/dashFiles/`)
        }

        await fs.writeFile(fileLocation, xmlData)
      }

      return [
        {
          url: uriSchema,
          type: 'application/dash+xml',
          label: 'Dash',
          qualityLabel: 'Auto'
        }
      ]
    },

    createInvidiousDashManifest: function () {
      let url = `${this.currentInvidiousInstance}/api/manifest/dash/id/${this.videoId}`

      if (!process.env.IS_ELECTRON || this.proxyVideos) {
        url += '?local=true'
      }

      return [
        {
          url: url,
          type: 'application/dash+xml',
          label: 'Dash',
          qualityLabel: 'Auto'
        }
      ]
    },

    createLocalStoryboardUrls: async function (storyboardInfo) {
      const results = buildVTTFileLocally(storyboardInfo)
      const userData = await getUserDataPath()
      let fileLocation
      let uriSchema

      // Dev mode doesn't have access to the file:// schema, so we access
      // storyboards differently when run in dev
      if (process.env.NODE_ENV === 'development') {
        fileLocation = `static/storyboards/${this.videoId}.vtt`
        uriSchema = `storyboards/${this.videoId}.vtt`
        // if the location does not exist, writeFile will not create the directory, so we have to do that manually
        if (!(await pathExists('static/storyboards/'))) {
          fs.mkdir('static/storyboards/')
        } else if (await pathExists(fileLocation)) {
          await fs.rm(fileLocation)
        }

        await fs.writeFile(fileLocation, results)
      } else {
        if (!(await pathExists(`${userData}/storyboards/`))) {
          await fs.mkdir(`${userData}/storyboards/`)
        }
        fileLocation = `${userData}/storyboards/${this.videoId}.vtt`
        uriSchema = `file://${fileLocation}`

        await fs.writeFile(fileLocation, results)
      }

      this.videoStoryboardSrc = uriSchema
    },

    tryAddingTranslatedLocaleCaption: function (captionTracks, locale, baseUrl) {
      const enCaptionIdx = captionTracks.findIndex(track =>
        track.language_code === 'en' && track.kind !== 'asr'
      )

      const enCaptionExists = enCaptionIdx !== -1
      const asrEnabled = captionTracks.some(track => track.kind === 'asr')

      if (enCaptionExists || asrEnabled) {
        let label
        let url

        if (this.$te('Video.translated from English') && this.$t('Video.translated from English') !== '') {
          label = `${this.$t('Locale Name')} (${this.$t('Video.translated from English')})`
        } else {
          label = `${this.$t('Locale Name')} (translated from English)`
        }

        const indexTranslated = captionTracks.findIndex((item) => {
          return item.label === label
        })
        if (indexTranslated !== -1) {
          return
        }

        if (enCaptionExists) {
          url = new URL(captionTracks[enCaptionIdx].url)
        } else {
          url = new URL(baseUrl)
          url.searchParams.set('lang', 'en')
          url.searchParams.set('kind', 'asr')
        }

        url.searchParams.set('tlang', locale)
        captionTracks.unshift({
          url: url.toString(),
          label,
          language_code: locale
        })
      }
    },

    createCaptionPromiseList: function (captionTracks) {
      return captionTracks.map(caption => new Promise((resolve, reject) => {
        caption.type = 'text/vtt'
        caption.charset = 'charset=utf-8'
        caption.dataSource = 'local'

        const url = new URL(caption.url)
        url.searchParams.set('fmt', 'vtt')

        fetch(url)
          .then((response) => response.text())
          .then((text) => {
            // The character '#' needs to be percent-encoded in a (data) URI
            // because it signals an identifier, which means anything after it
            // is automatically removed when the URI is used as a source
            let vtt = text.replaceAll('#', '%23')

            // A lot of videos have messed up caption positions that need to be removed
            // This can be either because this format isn't really used by YouTube
            // or because it's expected for the player to be able to somehow
            // wrap the captions so that they won't step outside its boundaries
            //
            // Auto-generated captions are also all aligned to the start
            // so those instances must also be removed
            // In addition, all aligns seem to be fixed to "start" when they do pop up in normal captions
            // If it's prominent enough that people start to notice, it can be removed then
            if (caption.kind === 'asr') {
              vtt = vtt.replaceAll(/ align:start| position:\d{1,3}%/g, '')
            } else {
              vtt = vtt.replaceAll(/ position:\d{1,3}%/g, '')
            }

            caption.url = `data:${caption.type};${caption.charset},${vtt}`
            resolve(caption)
          })
          .catch((error) => {
            console.error(error)
            reject(error)
          })
      }))
    },

    pausePlayer: function () {
      const player = this.$refs.videoPlayer.player
      if (player && !player.paused()) {
        player.pause()
      }
    },

    getWatchedProgress: function () {
      return this.$refs.videoPlayer && this.$refs.videoPlayer.player ? this.$refs.videoPlayer.player.currentTime() : 0
    },

    getTimestamp: function () {
      return Math.floor(this.getWatchedProgress())
    },

    getPlaylistIndex: function () {
      return this.$refs.watchVideoPlaylist
        ? this.getPlaylistReverse()
          ? this.$refs.watchVideoPlaylist.playlistItems.length - this.$refs.watchVideoPlaylist.currentVideoIndex
          : this.$refs.watchVideoPlaylist.currentVideoIndex - 1
        : -1
    },

    getPlaylistReverse: function () {
      return this.$refs.watchVideoPlaylist ? this.$refs.watchVideoPlaylist.reversePlaylist : false
    },

    getPlaylistShuffle: function () {
      return this.$refs.watchVideoPlaylist ? this.$refs.watchVideoPlaylist.shuffleEnabled : false
    },

    getPlaylistLoop: function () {
      return this.$refs.watchVideoPlaylist ? this.$refs.watchVideoPlaylist.loopEnabled : false
    },

    updateTitle: function () {
      document.title = `${this.videoTitle} - FreeTube`
    },

    ...mapActions([
      'updateHistory',
      'updateWatchProgress',
      'updateSubscriptionDetails'
    ])
  }
})
