#!/usr/bin/env python
# -*- coding: utf-8 -*-
# vim: ts=2 sw=2 et ai
###############################################################################
# Copyright (c) 2012,2013,2019 Andreas Vogel andreas@wellenvogel.net
#
#  Permission is hereby granted, free of charge, to any person obtaining a
#  copy of this software and associated documentation files (the "Software"),
#  to deal in the Software without restriction, including without limitation
#  the rights to use, copy, modify, merge, publish, distribute, sublicense,
#  and/or sell copies of the Software, and to permit persons to whom the
#  Software is furnished to do so, subject to the following conditions:
#
#  The above copyright notice and this permission notice shall be included
#  in all copies or substantial portions of the Software.
#
#  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
#  OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
#  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
#  THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
#  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
#  FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
#  DEALINGS IN THE SOFTWARE.
#
#  parts from this software (AIS decoding) are taken from the gpsd project
#  so refer to this BSD licencse also (see ais.py) or omit ais.py 
###############################################################################

import json
import threading
import pprint
import time
import traceback

from avnav_util import *


#the main List of navigational items received
class AVNStore():
  SOURCE_KEY_AIS = 'AIS'
  SOURCE_KEY_GPS = 'GPS'
  SOURCE_KEY_OTHER = 'OTHER'
  BASE_KEY_GPS = 'gps'
  BASE_KEY_AIS = 'ais'
  BASE_KEY_SKY = 'sky'
  # AIS messages we store
  knownAISTypes = (1, 2, 3, 5, 18, 19, 24)
  class DataEntry:
    def __init__(self,value,source=None,priority=0):
      self.value=value
      self.timestamp=AVNUtil.utcnow()
      self.source=source
      self.priority=priority

  class AisDataEntry:
    def __init__(self,data):
      self.value=data
      self.timestamp = AVNUtil.utcnow()
      self.source=AVNStore.SOURCE_KEY_AIS
  #fields we merge
  ais5mergeFields=['imo_id','callsign','shipname','shiptype','destination']
  def __init__(self,expiryTime,aisExpiryTime,ownMMSI):
    self.__list={}
    self.__aisList={}
    self.__listLock=threading.Lock()
    self.__aisLock = threading.Lock()
    self.__expiryTime=expiryTime
    self.__aisExpiryTime=aisExpiryTime
    self.__ownMMSI=ownMMSI
    self.__prefixCounter={} #contains the number of entries for TPV, AIS,...
    self.__lastSources={} #contains the last source for each class
    # a description of the already registered keys
    self.__registeredKeys={} # type: dict
    # for wildcard keys we speed up by storing keys we already found
    self.__approvedKeys=set()
    # store for the wildcard keys
    self.__wildcardKeys={}
    # all the key sources
    self.__keySources={}

  def __registerInternalKeys(self):
    self.registerKey(self.BASE_KEY_AIS+".count","AIS count",self.__class__.__name__)
    self.registerKey(self.BASE_KEY_AIS+".entities.*","AIS entities",self.__class__.__name__)

  def __isExpired(self, entry, now=None):
    if now is None:
      now=AVNUtil.utcnow()
    et = now - self.__expiryTime
    return entry.timestamp < et
  def __isAisExpired(self, aisEntry, now=None):
    if now is None:
      now=AVNUtil.utcnow()
    et=now - self.__aisExpiryTime
    return aisEntry.timestamp < et

  def setValue(self,key,value,source=None,priority=0):
    """
    set a data value
    @param key: the key to be set
    @param value: either a string/number/boolean or a dict
                  if the value is a dict, all its keys will be added to the provided key and the values will be set
    @param source: optional a source key
    @return:
    """
    AVNLog.ld("AVNNavData set value key=%s", key, value)
    self.__listLock.acquire()
    isDict=False
    dataValue=value
    try:
      keylist=['']
      if type(value) == dict:
        keylist=value.keys()
        isDict=True
      for kext in keylist:
        if isDict:
          listKey=key+'.'+kext
          dataValue=value[kext]
        else:
          listKey=key
        if not self.__allowedKey(listKey):
          AVNLog.error("key %s is not registered in store" , listKey)
          raise Exception("key %s is not registered in store" % (listKey))
        existing=self.__list.get(listKey)
        doUpdate=True
        if existing is not None:
          if not self.__isExpired(existing) and existing.priority > priority:
            doUpdate=False
        if doUpdate:
          self.__list[listKey]=AVNStore.DataEntry(dataValue, priority=priority)
          sourceKey=AVNStore.SOURCE_KEY_OTHER
          if key.startswith(AVNStore.BASE_KEY_GPS):
            sourceKey=AVNStore.SOURCE_KEY_GPS
          self.__lastSources[sourceKey]=source
        else:
          AVNLog.debug("AVNavData: keeping existing entry for %s",listKey)
    except :
      self.__listLock.release()
      AVNLog.error("exception in writing data: %",traceback.format_exc())
      raise
    self.__listLock.release()

  def setAisValue(self,mmsi,data,source=None):
    """
    add an AIS entry
    @param mmsi:
    @param data:
    @return:
    """
    AVNLog.debug("AVNavData add ais %s",mmsi)
    if self.__ownMMSI != '' and mmsi is not None and self.__ownMMSI == mmsi:
      AVNLog.debug("omitting own AIS message mmsi %s", self.__ownMMSI)
      return
    key=AVNStore.BASE_KEY_AIS+"."+mmsi
    now=AVNUtil.utcnow()
    self.__aisLock.acquire()
    existing=self.__aisList.get(key)
    if existing is None:
      existing=AVNStore.AisDataEntry({'mmsi':mmsi})
      self.__aisList[key]=existing
    if data.get('type') == '5' or data.get('type') == '24':
      #add new items to existing entry
      AVNLog.debug("merging AIS type 5/24 with existing message")
      for k in self.ais5mergeFields:
        v = data.get(k)
        if v is not None:
          existing.value[k] = v
          existing.timestamp=now
    else:
      AVNLog.debug("merging AIS with existing message")
      newData=data.copy()
      for k in self.ais5mergeFields:
        v = existing.value.get(k)
        if v is not None:
          newData[k] = v
      existing.value=newData
      existing.timestamp=now
    self.__lastSources[AVNStore.SOURCE_KEY_AIS]=source
    self.__aisLock.release()


  def getAisData(self, asDict=False):
    rt=[] if not asDict else {}
    keysToRemove=[]
    now=AVNUtil.utcnow()
    self.__aisLock.acquire()
    try:
      for key in self.__aisList.keys():
        aisEntry=self.__aisList[key]
        if self.__isAisExpired(aisEntry, now):
          keysToRemove.append(key)
        else:
          if asDict:
            rt[key]=aisEntry.value
          else:
            rt.append(aisEntry.value)
      for rkey in keysToRemove:
        del self.__aisList[rkey]
    except:
      AVNLog.error("error when reading AIS data %s",traceback.format_exc())
      self.__aisLock.release()
      raise
    self.__aisLock.release()
    return rt

  def getSingleValue(self,key):
    self.__listLock.acquire()
    rt=self.__list.get(key)
    self.__listLock.release()
    if rt is None:
      return None
    if self.__isExpired(rt):
      return None
    if type(rt.value) == dict:
      return None
    return rt.value

  def getDataByPrefix(self,prefix,levels=None):
    """
    get all entries with a certain prefix
    the prefix must exactly be a part of the key until a . (but not including it)
    @param prefix: the prefix
    @param levels: the number of levels to be returned (default: all)
    @return: a dict with all entries, keys having the prefix removed
    """
    if prefix == self.BASE_KEY_AIS:
      rt={}
      rt['entities']=self.getAisData(True).copy()
      rt['count']=self.getAisCounter()
      return rt
    prefix=prefix+"."
    plen=len(prefix)
    rt={}
    self.__listLock.acquire()
    try:
      now=AVNUtil.utcnow()
      keysToRemove=[]
      for key in self.__list.keys():
        if not key.startswith(prefix):
          continue
        entry=self.__list[key]
        if self.__isExpired(entry, now):
          keysToRemove.append(key)
        else:
          nkey=key[plen:]
          if nkey.find(".") >= 0:
            nkey=re.sub('\.*$','',nkey)
          if nkey.find(".") >= 0:
            #compound key
            keyparts=nkey.split(".")
            numparts=len(keyparts)
            current=rt
            for i in range(0,numparts-1):
              if current.get(keyparts[i]) is None:
                current[keyparts[i]]={}
              current=current[keyparts[i]]
              if not type(current) == dict:
                raise Exception("inconsistent data , found normal value and dict with key %s"%(".".join(keyparts[0:i])))
            current[keyparts[-1]]=entry.value
          else:
            rt[nkey]=entry.value
      for rkey in keysToRemove:
        del self.__list[rkey]
    except:
      self.__listLock.release()
      AVNLog.error("error getting value with prefix %s: %s"%(prefix,traceback.format_exc()))
      raise
    self.__listLock.release()
    return rt

  #delete all entries from the list (e.g. when we have to set the time)
  def reset(self): 
    self.__listLock.acquire()
    self.__list.clear()
    self.__aisList.clear()
    self.__listLock.release()

  def getAisCounter(self):
    return len(self.__aisList)


  def getLastSource(self,cls):
    rt=self.__lastSources.get(cls)
    if rt is None:
      rt=""
    return rt
  KEY_PATTERN='^[a-zA-Z0-9_.*]*$'
  def __checkKey(self, key):
    if re.match(self.KEY_PATTERN,key) is None:
      raise Exception("key %s does not match pattern %s"%(key,self.KEY_PATTERN))
  def __isWildCard(self, key):
    return key.find('*') >= 0

  def __wildCardMatch(self,key,wildcardKey):
    keyParts=key.split('.')
    wildCardParts=wildcardKey.split('.')
    if len(keyParts) < len(wildCardParts):
      return False
    if len(wildCardParts) < len(keyParts):
      if wildCardParts[-1] == '*':
        return True
      return False
    for x in range(0,len(keyParts)):
      if keyParts[x] != wildCardParts[x] and wildCardParts[x] != '*':
        return False
    return True

  def __allowedKey(self,key):
    """
    check if a key is allowed
    fill the approved keys if a new wildcard match has been found
    @param key:
    @return: True if ok, False otherwise
    """
    if self.__registeredKeys.has_key(key):
      return True
    if key in self.__approvedKeys:
      return True
    for wildcard in self.__wildcardKeys.keys():
      if self.__wildCardMatch(key,wildcard):
        self.__approvedKeys.add(key)
        return True
    return False



  def registerKey(self,key,keyDescription,source=None):
    """
    register a new key description
    raise an exception if there is already a key with the same name or a prefix of it
    @param key:
    @param keyDescription:
    @return:
    """
    self.__checkKey(key)
    for existing in self.__registeredKeys.keys():
      if existing == key or key.startswith(existing):
        raise Exception("key %s already registered from %s:%s" % (key,existing,self.__registeredKeys[existing]))
    for existing in self.__wildcardKeys.keys():
      if self.__wildCardMatch(key,existing):
        raise Exception("key %s matches wildcard from %s:%s" % (key, existing, self.__wildcardKeys[existing]))
    if self.__isWildCard(key):
      for existing in self.__registeredKeys.keys():
        if self.__wildCardMatch(existing,key):
          raise Exception("wildcard key %s matches existing from %s:%s" % (key, existing, self.__registeredKeys[existing]))
    self.__keySources[key]=source
    if self.__isWildCard(key):
      self.__wildcardKeys[key]=keyDescription
    else:
      self.__registeredKeys[key] = keyDescription

  def getRegisteredKeys(self):
    return self.__registeredKeys.copy().update(self.__wildcardKeys)



  
  def __unicode__(self):
    rt="%s \n"%self.__class__.__name__
    idx=0
    self.__listLock.acquire()
    for k in self.__list.keys():
      rt+="   (%03d:%s)%s=%s\n" % (idx, time.strftime("%Y/%m/%d-%H:%M:%S ", time.gmtime(self.__list[k].timestamp)), k, self.__list[k].value)
    self.__listLock.release()
    return rt