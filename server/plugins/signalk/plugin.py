import datetime
import json
import re
import sys
import threading
import time
#the following import is optional
#it only allows "intelligent" IDEs (like PyCharm) to support you in using it
import traceback
import urllib
hasWebsockets=False
try:
  import websocket
  hasWebsockets=True
except:
  pass

from avnav_api import AVNApi


class Plugin:
  PATH="gps.signalk"
  CHARTNAME_PREFIX="sk-"
  AVNAV_XML="""<?xml version="1.0" encoding="UTF-8" ?>
  <TileMapService version="1.0.0" >
   <Title>%(title)s</Title>
   <TileMaps>
     <TileMap 
       title="%(title)s" 
       href="%(url)s"
       minzoom="%(minzoom)s"
       maxzoom="%(maxzoom)s"
       projection="EPSG:4326">
             <BoundingBox minlon="%(minlon)f" minlat="%(minlat)f" maxlon="%(maxlon)f" maxlat="%(maxlat)f" title="layer"/>
       <TileFormat width="256" height="256" mime-type="x-%(format)s" extension="%(format)s" />
    </TileMap>       
   </TileMaps>
 </TileMapService>

  """

  @classmethod
  def pluginInfo(cls):
    """
    the description for the module
    @return: a dict with the content described below
            parts:
               * description (mandatory)
               * data: list of keys to be stored (optional)
                 * path - the key - see AVNApi.addData, all pathes starting with "gps." will be sent to the GUI
                 * description
    """
    return {
      'description': 'a plugin that fetches vessels data from signalk',
      'version': '1.0',
      'config':[
        {
          'name':'enabled',
          'description':'set to true to enable plugin',
          'default':'false'
        },
        {
          'name':'port',
          'description':'set to signalk port',
          'default':'3000'
        },
        {
          'name': 'host',
          'description': 'set to signalk host',
          'default': 'localhost'
        },
        {
          'name':'period',
          'description':'query period in ms',
          'default':'1000'
        },
        {
          'name': 'chartQueryPeriod',
          'description': 'charts query period in ms, 0 to disable',
          'default': '10000'
        },
        {
          'name': 'chartProxyMode',
          'description': 'proxy tile requests: never,always,sameHost',
          'default': 'sameHost'
        },
        {
          'name': 'useWebsockets',
          'description': 'use websockets if the package is available - true or false',
          'default': 'true'
        },

      ],
      'data': [
        {
          'path': cls.PATH+".*",
          'description': 'vessels data from signalk',
        }
      ]
    }

  def __init__(self,api):
    """
        initialize a plugins
        do any checks here and throw an exception on error
        do not yet start any threads!
        @param api: the api to communicate with avnav
        @type  api: AVNApi
    """
    self.api = api # type: AVNApi
    self.api.registerRequestHandler(self.requestHandler)
    self.skCharts=[]
    self.connected=False
    self.skHost='localhost'
    self.proxyMode='sameHost'
    self.webSocket=None
    self.useWebsockets=True



  def run(self):
    """
    the run method
    this will be called after successfully instantiating an instance
    this method will be called in a separate Thread
    The example simply counts the number of NMEA records that are flowing through avnav
    and writes them to the store every 10 records
    @return:
    """
    enabled = self.api.getConfigValue('enabled','false')
    if enabled.lower() != 'true':
      self.api.setStatus("INACTIVE","module not enabled in server config")
      self.api.log("module disabled")
      return
    port=3000
    period=1000
    chartQueryPeriod=10
    try:
      port=self.api.getConfigValue('port','3000')
      port=int(port)
      period=self.api.getConfigValue('period','1000')
      period=int(period)
      self.skHost=self.api.getConfigValue('host','localhost')
      chartQueryPeriod=int(self.api.getConfigValue('chartQueryPeriod','10000'))/1000
      self.proxyMode=self.api.getConfigValue('proxyMode','sameHost')
      self.useWebSockets=self.api.getConfigValue('useWebsockets','true').lower() == 'true'
    except:
      self.api.log("exception while reading config values %s",traceback.format_exc())
      raise
    self.api.log("started with port %d, period %d"%(port,period))
    baseUrl="http://%s:%d/signalk"%(self.skHost,port)
    self.api.registerUserApp("http://$HOST:%s"%port,"signalk.svg")
    self.api.registerLayout("example","example.json")
    self.api.registerChartProvider(self.listCharts)
    errorReported=False
    self.api.setStatus("STARTED", "connecting at %s" % baseUrl)
    while True:
      apiUrl=None
      websocketUrl=None
      if self.webSocket is not None:
        try:
          self.webSocket.close()
        except:
          pass
        self.webSocket=None
      while apiUrl is None:
        self.connected=False
        responseData=None
        try:
          response=urllib.urlopen(baseUrl)
          if response is None:
            raise Exception("no response on %s"%baseUrl)
          responseData=json.loads(response.read())
          if responseData is None:
            raise Exception("no response on %s"%baseUrl)
          #{"endpoints":{"v1":{"version":"1.20.0","signalk-http":"http://localhost:3000/signalk/v1/api/","signalk-ws":"ws://localhost:3000/signalk/v1/stream","signalk-tcp":"tcp://localhost:8375"}},"server":{"id":"signalk-server-node","version":"1.20.0"}}
          endpoints = responseData.get('endpoints')
          if endpoints is None:
            raise Exception("no endpoints in response to %s"%baseUrl)
          for k in endpoints.keys():
            ep=endpoints[k]
            if apiUrl is None:
              apiUrl=ep.get('signalk-http')
              if apiUrl is not None:
                errorReported=False
            if websocketUrl is None:
              websocketUrl=ep.get("signalk-ws")
        except:
          if not errorReported:
            self.api.setStatus("ERROR", "unable to connect at %s" % baseUrl)
            self.api.log("unable to connect at url %s: %s" % (baseUrl, sys.exc_info()[0]))
            errorReported=True
          time.sleep(1)
          continue
        if apiUrl is None:
          time.sleep(1)
        else:
          self.api.log("found api url %s",apiUrl)
      selfUrl=apiUrl+"vessels/self"
      self.connected = True
      useWebsockets = self.useWebsockets and hasWebsockets and websocketUrl is not None
      self.api.log("using websockets: %s",websocketUrl)
      if useWebsockets:
        if self.webSocket is not None:
          try:
            self.webSocket.close()
          except:
            self.api.debug("error when closing websocket: %s",traceback.format_exc())
        self.webSocket=websocket.WebSocketApp(websocketUrl,
                                    on_error=self.webSocketError,
                                    on_message=self.webSocketMessage,
                                    on_close=self.webSocketClose)
        webSocketThread=threading.Thread(name="signalk-websocket",target=self.webSocket.run_forever)
        webSocketThread.setDaemon(True)
        webSocketThread.start()
      try:
        lastChartQuery=0
        first=True # when we newly connect, just query everything once
        while self.connected:
          if not useWebsockets or first:
            response=urllib.urlopen(selfUrl)
            if response is None:
              self.skCharts=[]
              raise Exception("unable to fetch from %s:%s",selfUrl,sys.exc_info()[0])
            if not first:
              self.api.setStatus("NMEA", "connected at %s" % apiUrl)
            data=json.loads(response.read())
            self.api.debug("read: %s",json.dumps(data))
            self.storeData(data,self.PATH)
            first=False
            name=data.get('name')
            if name is not None:
              self.api.addData(self.PATH+".name",name)
          else:
            pass
          if chartQueryPeriod > 0 and lastChartQuery < (time.time() - chartQueryPeriod):
            lastChartQuery=time.time()
            try:
              self.queryCharts(apiUrl,port)
            except Exception as e:
              self.skCharts=[]
              self.api.debug("exception while reading chartlist %s",traceback.format_exc())
          time.sleep(float(period)/1000.0)
      except:
        self.api.log("error when fetching from signalk %s: %s",apiUrl,traceback.format_exc())
        self.api.setStatus("ERROR","error when fetching from signalk %s"%(apiUrl))
        self.connected=False
        time.sleep(5)

  def webSocketError(self,ws,error):
    self.api.setStatus("ERROR","error on websocket connection %s: %s"%(ws.url,error))
    self.api.error("error on websocket connection: %s",error)
    try:
      self.webSocket.close()
    except:
      pass
    self.webSocket=None
    self.connected=False

  def webSocketClose(self,ws):
    self.api.log("websocket connection closed")
    self.api.setStatus("ERROR", "connection closed at %s" % ws.url)
    self.connected=False
    self.webSocket=None

  def webSocketMessage(self,ws,message):
    self.api.setStatus("NMEA", "connected at %s" % ws.url)
    try:
      data=json.loads(message)
      updates=data.get('updates')
      if updates is None:
        return
      for update in updates:
        values=update.get('values')
        if values is None:
          continue
        for item in values:
          value=item.get('value')
          path=item.get('path')
          if value is not None and path is not None:
            if path.startswith("notifications"):
              #TODO: handle notifications
              pass
            else:
              self.api.addData(self.PATH+"."+path,value, 'signalk')
    except:
      self.api.error("error decoding %s:%s",message,traceback.format_exc())
      try:
        self.webSocket.close()
      except:
        pass
      self.webSocket=None
      self.connected=False

  def queryCharts(self,apiUrl,port):
    charturl = apiUrl + "resources/charts"
    chartlistResponse = urllib.urlopen(charturl)
    if chartlistResponse is None:
      self.skCharts = []
      return
    chartlist = json.loads(chartlistResponse.read())
    newList = []
    pluginUrl= self.api.getBaseUrl()
    baseUrl = pluginUrl + "/api/charts/"
    for chart in chartlist.values():
      name = chart.get('identifier')
      if name is None:
        continue
      name = self.CHARTNAME_PREFIX + name
      url = baseUrl + urllib.quote(name)
      bounds=chart.get('bounds')
      #bounds is upperLeftLon,upperLeftLat,lowerRightLon,lowerRightLat
      #          minlon,      maxlat,      maxlon,       minlat
      if bounds is None:
        bounds=[-180,85,180,-85]
      if bounds[1] < bounds[3]:
        #it seems that the plugin does not really provide the BB correctly...
        tmp=bounds[3]
        bounds[3]=bounds[1]
        bounds[1]=tmp
      chartInfo = {
        'name': name,
        'url': url,
        'charturl': url,
        'sequence': 0,  # TODO
        'canDelete': False,
        'icon': pluginUrl+"/signalk.svg",
        'internal': {
          'url': "http://%s:%d" % (self.skHost, port) + chart.get('tilemapUrl'),
          'minlon': bounds[0],
          'maxlat': bounds[1],
          'maxlon': bounds[2],
          'minlat': bounds[3],
          'format': chart.get('format') or 'png',
          'bounds': chart.get('bounds'),
          'minzoom': chart.get('minzoom'),
          'maxzoom': chart.get('maxzoom')
        }
      }
      newList.append(chartInfo)
    self.skCharts = newList
  def storeData(self,node,prefix):
    if 'value' in node:
      self.api.addData(prefix, node.get('value'), 'signalk')
      return
    for key, item in node.items():
      if isinstance(item,dict):
        self.storeData(item,prefix+"."+key)

  def listCharts(self,hostip):
    self.api.debug("listCharts %s"%hostip)
    if not self.connected:
      self.api.debug("not yet connected")
      return []
    try:
      rt=[]
      items=self.skCharts+[]
      for item in items:
        cp=item.copy()
        del cp['internal']
        rt.append(cp)
      return rt
    except:
      self.api.debug("unable to list charts: %s"%traceback.format_exc())
      return []

  def requestHandler(self,url,handler,args):
    '''
    handle api requests
    @param url:
    @param handler:
    @param args:
    @return:
    '''
    if url.startswith("charts/"):
      chart=url[len("charts/"):]
      parr=chart.split("/")
      if len(parr) < 2:
        raise Exception("invalid chart url %s"%url)
      chartName = parr[0]
      chart=None
      for chartinfo in self.skCharts:
        if chartinfo.get('name')==chartName:
          chart=chartinfo
          break
      if chart is None:
        raise Exception("chart %s not found"%chartName)
      if parr[1] == "avnav.xml":
        requestHost = handler.headers.get('host')
        requestHostAddr = requestHost.split(':')[0]
        url='tiles'
        doProxy=False
        if self.proxyMode=='always' or ( self.proxyMode=='sameHost' and self.skHost != 'localhost'):
          doProxy=True
        if not doProxy:
          #no proxying, direct access to sk for charts
          url=chart['internal']['url'].replace('localhost',requestHostAddr)
        param=chart['internal'].copy()
        param.update({
          'title':chart['name'],
          'url':url,
        })
        data=self.AVNAV_XML%param
        handler.send_response(200)
        handler.send_header("Content-type", "text/xml")
        handler.send_header("Content-Length", len(data))
        handler.send_header("Last-Modified", handler.date_time_string())
        handler.end_headers()
        handler.wfile.write(data)
        return True
      if parr[1] == "sequence":
        return {'status':'OK','sequence':0}
      if len(parr) < 5:
        raise Exception("invalid request to chart %s: %s" % (chartName, url))
      replaceV={'z':parr[2],
                'x':parr[3],
                'y':re.sub("\..*","",parr[4])}
      skurl=chart['internal']['url']
      for k in replaceV.keys():
        skurl=skurl.replace("{"+k+"}",replaceV[k])
      try:
        tile = urllib.urlopen(skurl)
        if tile is None:
          return None
        tileData = tile.read()
      except:
        self.api.debug("unable to read tile from sk %s:%s"%(url,traceback.format_exc()))
        return
      handler.send_response(200)
      handler.send_header("Content-type", "image/%s"%chart['internal']['format'])
      handler.send_header("Content-Length", len(tileData))
      handler.send_header("Last-Modified", handler.date_time_string())
      handler.end_headers()
      handler.wfile.write(tileData)
      return True





